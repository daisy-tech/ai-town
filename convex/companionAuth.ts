import { ConvexError, v } from 'convex/values';
import { DatabaseReader, internalMutation, mutation, query } from './_generated/server';
import { Id } from './_generated/dataModel';

// 手机号 + 验证码登录（macOS 客户端）。
//
// 测试模式：还没接短信服务，requestCode 直接把验证码返回给客户端显示在
// 界面上。以后接阿里云短信时只改 requestCode 的实现（发短信、不返回码），
// 表结构和其余接口都不动。

const CODE_TTL = 10 * 60 * 1000;
const CODE_REQUEST_INTERVAL = 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;
const PHONE_RE = /^1[3-9]\d{9}$/;

export async function sessionByToken(db: DatabaseReader, token: string) {
  return await db
    .query('authSessions')
    .withIndex('token', (q) => q.eq('token', token))
    .unique();
}

export function authError() {
  // 客户端识别这个前缀后回到登录页（见 AppModel.handleAuthFailure）。
  return new ConvexError('登录已失效，请重新登录');
}

async function accountByPhone(db: DatabaseReader, phone: string) {
  return await db
    .query('accounts')
    .withIndex('phone', (q) => q.eq('phone', phone))
    .unique();
}

async function childrenOfAccount(db: DatabaseReader, accountId: Id<'accounts'>) {
  return await db
    .query('children')
    .withIndex('accountId', (q) => q.eq('accountId', accountId))
    .collect();
}

function normalizePhone(raw: string): string {
  const phone = raw.replace(/[\s-]/g, '');
  if (!PHONE_RE.test(phone)) {
    throw new ConvexError('请输入正确的手机号');
  }
  return phone;
}

// 请求验证码。同一手机号一分钟内只发一次。
export const requestCode = mutation({
  args: {
    phone: v.string(),
  },
  handler: async (ctx, args) => {
    const phone = normalizePhone(args.phone);
    const now = Date.now();
    const existing = await ctx.db
      .query('smsCodes')
      .withIndex('phone', (q) => q.eq('phone', phone))
      .order('desc')
      .collect();
    const latest = existing[0];
    if (latest && now - latest._creationTime < CODE_REQUEST_INTERVAL) {
      throw new ConvexError('验证码刚发过啦，等一分钟再试');
    }
    // 顺手清掉这个号码的历史验证码（都已过期或将作废）。
    for (const row of existing) {
      await ctx.db.delete(row._id);
    }
    const code = String(Math.floor(100000 + Math.random() * 900000));
    await ctx.db.insert('smsCodes', {
      phone,
      code,
      expiresAt: now + CODE_TTL,
      attempts: 0,
    });
    // 测试模式：把码直接带回客户端显示。接真短信后删掉这个字段即可。
    return { code };
  },
});

// 校验验证码并登录：找到或创建账号，签发新的会话 token。
export const verifyCode = mutation({
  args: {
    phone: v.string(),
    code: v.string(),
  },
  handler: async (ctx, args) => {
    const phone = normalizePhone(args.phone);
    const now = Date.now();
    const row = await ctx.db
      .query('smsCodes')
      .withIndex('phone', (q) => q.eq('phone', phone))
      .order('desc')
      .first();
    if (!row || row.usedAt || row.expiresAt < now) {
      throw new ConvexError('验证码已过期，请重新获取');
    }
    if (row.attempts >= MAX_CODE_ATTEMPTS) {
      throw new ConvexError('错误次数太多，请重新获取验证码');
    }
    if (row.code !== args.code.trim()) {
      await ctx.db.patch(row._id, { attempts: row.attempts + 1 });
      throw new ConvexError('验证码不对，再看看？');
    }
    await ctx.db.patch(row._id, { usedAt: now });

    let account = await accountByPhone(ctx.db, phone);
    if (!account) {
      const accountId = await ctx.db.insert('accounts', { phone, createdAt: now });
      account = (await ctx.db.get(accountId))!;
    }
    const children = await childrenOfAccount(ctx.db, account._id);
    const currentChild = children[0] ?? null;

    const token = crypto.randomUUID();
    await ctx.db.insert('authSessions', {
      token,
      accountId: account._id,
      currentChildId: currentChild?._id,
      createdAt: now,
      lastActiveAt: now,
    });
    return {
      deviceToken: token,
      childName: currentChild?.name ?? null,
    };
  },
});

// 账号名下的宠物列表（每个孩子档案至多一只活跃宠物）。
export const listPets = query({
  args: {
    deviceToken: v.string(),
  },
  handler: async (ctx, args) => {
    const session = await sessionByToken(ctx.db, args.deviceToken);
    if (!session) {
      throw authError();
    }
    const children = await childrenOfAccount(ctx.db, session.accountId);
    const pets = [];
    for (const child of children) {
      const adoptions = await ctx.db
        .query('adoptions')
        .withIndex('childId', (q) => q.eq('childId', child._id))
        .collect();
      const adoption = adoptions.find((a) => a.status !== 'failed') ?? null;
      pets.push({
        childId: child._id,
        childName: child.name,
        petName: adoption?.petName ?? null,
        species: adoption?.species ?? null,
        status: adoption?.status ?? null,
        current: session.currentChildId === child._id,
      });
    }
    return pets;
  },
});

// 切换当前设备正在看的宠物（孩子档案）。
export const selectPet = mutation({
  args: {
    deviceToken: v.string(),
    childId: v.id('children'),
  },
  handler: async (ctx, args) => {
    const session = await sessionByToken(ctx.db, args.deviceToken);
    if (!session) {
      throw authError();
    }
    const child = await ctx.db.get(args.childId);
    if (!child || child.accountId !== session.accountId) {
      throw new ConvexError('这只宠物不在你的账号里');
    }
    await ctx.db.patch(session._id, { currentChildId: args.childId, lastActiveAt: Date.now() });
    return null;
  },
});

// 退出登录：吊销会话。幂等。
export const logout = mutation({
  args: {
    deviceToken: v.string(),
  },
  handler: async (ctx, args) => {
    const session = await sessionByToken(ctx.db, args.deviceToken);
    if (session) {
      await ctx.db.delete(session._id);
    }
    return null;
  },
});

// 一次性迁移：把账号体系之前创建的孩子档案绑定到手机号账号。
// 用法：npx convex run companionAuth:bindLegacyChild '{"phone":"189...","childId":"..."}'
export const bindLegacyChild = internalMutation({
  args: {
    phone: v.string(),
    childId: v.id('children'),
  },
  handler: async (ctx, args) => {
    const phone = normalizePhone(args.phone);
    const child = await ctx.db.get(args.childId);
    if (!child) {
      throw new ConvexError(`Child ${args.childId} not found`);
    }
    let account = await accountByPhone(ctx.db, phone);
    if (!account) {
      const accountId = await ctx.db.insert('accounts', { phone, createdAt: Date.now() });
      account = (await ctx.db.get(accountId))!;
    }
    await ctx.db.patch(child._id, { accountId: account._id });
    return `Child ${child.name} (${child._id}) bound to account ${phone}`;
  },
});
