import { ConvexError, v } from 'convex/values';
import {
  DatabaseReader,
  MutationCtx,
  internalMutation,
  mutation,
  query,
} from './_generated/server';
import { Id } from './_generated/dataModel';
import { internal } from './_generated/api';
import { insertInput } from './aiTown/insertInput';
import { startEngine } from './aiTown/main';
import {
  COMPANION_VISIT_ACTIVITY,
  COMPANION_VISIT_DURATION,
  MAX_PLAYER_NAME_LENGTH,
} from './constants';

// 领养可选的物种。character 决定宠物在 2D 小镇里的形象（复用现有 spritesheet），
// traits 用于生成专属的身份设定。
export const SPECIES = [
  { species: '狐狸', character: 'f1', trait: '活泼好奇，喜欢新鲜事和聊天' },
  { species: '猫咪', character: 'f2', trait: '安静细心，喜欢画画和观察小变化' },
  { species: '熊猫', character: 'f3', trait: '稳重温和，喜欢做计划和照顾别人' },
  { species: '小狗', character: 'f4', trait: '乐观勇敢，有正义感，喜欢保护朋友' },
  { species: '兔子', character: 'f5', trait: '温柔敏感，喜欢音乐、花朵和安静的陪伴' },
];

const MAX_MESSAGE_LENGTH = 500;
// The engine may take a while to wake up and process the join input, so poll
// for up to two minutes before declaring the adoption failed.
const FINALIZE_ADOPTION_MAX_ATTEMPTS = 60;
const FINALIZE_ADOPTION_POLL_MS = 2000;

async function childByToken(db: DatabaseReader, deviceToken: string) {
  const child = await db
    .query('children')
    .withIndex('deviceToken', (q) => q.eq('deviceToken', deviceToken))
    .unique();
  if (!child) {
    throw new ConvexError('设备未注册，请先注册');
  }
  return child;
}

async function activeAdoption(db: DatabaseReader, childId: Id<'children'>) {
  const adoptions = await db
    .query('adoptions')
    .withIndex('childId', (q) => q.eq('childId', childId))
    .collect();
  return adoptions.find((a) => a.status !== 'failed') ?? null;
}

async function defaultWorldId(db: DatabaseReader): Promise<Id<'worlds'>> {
  const worldStatus = await db
    .query('worldStatus')
    .filter((q) => q.eq(q.field('isDefault'), true))
    .first();
  if (!worldStatus) {
    throw new ConvexError('小镇尚未初始化');
  }
  return worldStatus.worldId;
}

// The engine pauses when nobody is watching the world. Companion clients count
// as viewers too: bump lastViewed and restart an inactive engine so pet
// inputs (adoption, visits) actually get processed.
async function wakeWorld(ctx: MutationCtx, worldId: Id<'worlds'>) {
  const worldStatus = await ctx.db
    .query('worldStatus')
    .withIndex('worldId', (q) => q.eq('worldId', worldId))
    .unique();
  if (!worldStatus) {
    throw new ConvexError(`Invalid world ID: ${worldId}`);
  }
  await ctx.db.patch(worldStatus._id, { lastViewed: Date.now() });
  if (worldStatus.status === 'inactive') {
    console.log(`Companion client waking up inactive world ${worldId}`);
    await ctx.db.patch(worldStatus._id, { status: 'running' });
    await startEngine(ctx, worldId);
  }
}

// 客户端在线期间定期调用（约每分钟一次），保持宠物所在的世界运转。
export const heartbeat = mutation({
  args: {
    deviceToken: v.string(),
  },
  handler: async (ctx, args) => {
    const child = await childByToken(ctx.db, args.deviceToken);
    const adoption = await activeAdoption(ctx.db, child._id);
    const worldId = adoption?.worldId ?? (await defaultWorldId(ctx.db));
    await wakeWorld(ctx, worldId);
  },
});

// 注册孩子身份。返回的 deviceToken 是客户端后续所有请求的凭证，
// 客户端应将其保存在钥匙串中。
export const registerChild = mutation({
  args: {
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const name = args.name.trim();
    if (!name) {
      throw new ConvexError('名字不能为空');
    }
    if (name.length > MAX_PLAYER_NAME_LENGTH) {
      throw new ConvexError(`名字最长${MAX_PLAYER_NAME_LENGTH}个字符`);
    }
    const deviceToken = crypto.randomUUID();
    const childId = await ctx.db.insert('children', {
      name,
      deviceToken,
      createdAt: Date.now(),
    });
    return { childId, deviceToken };
  },
});

export const speciesOptions = query({
  args: {},
  handler: async () => SPECIES,
});

// 领养一只专属学徒宠物。宠物会作为一个完整的 agent 加入共享小镇，
// 引擎处理完 createCompanionPet 输入后 finalizeAdoption 会补齐 agentId/playerId。
export const adoptPet = mutation({
  args: {
    deviceToken: v.string(),
    petName: v.string(),
    species: v.string(),
  },
  handler: async (ctx, args) => {
    const child = await childByToken(ctx.db, args.deviceToken);
    const existing = await activeAdoption(ctx.db, child._id);
    if (existing) {
      throw new ConvexError('你已经有一只宠物啦');
    }
    const petName = args.petName.trim();
    if (!petName) {
      throw new ConvexError('宠物名字不能为空');
    }
    if (petName.length > MAX_PLAYER_NAME_LENGTH) {
      throw new ConvexError(`宠物名字最长${MAX_PLAYER_NAME_LENGTH}个字符`);
    }
    const speciesInfo = SPECIES.find((s) => s.species === args.species);
    if (!speciesInfo) {
      throw new ConvexError(`不支持的物种：${args.species}`);
    }
    const worldId = await defaultWorldId(ctx.db);

    // 名字不能和小镇里现有的活跃角色重复，避免记忆串号。
    const world = await ctx.db.get(worldId);
    if (!world) {
      throw new ConvexError('小镇不存在');
    }
    const playerDescriptions = await ctx.db
      .query('playerDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', worldId))
      .collect();
    const activePlayerIds = new Set(world.players.map((p) => p.id));
    if (playerDescriptions.some((d) => activePlayerIds.has(d.playerId) && d.name === petName)) {
      throw new ConvexError(`名字"${petName}"已被使用，换一个吧`);
    }

    const identity = [
      `你是${speciesInfo.species}${petName}，${child.name}领养的专属伙伴，也是疯狂动物城的学徒居民。`,
      `你${speciesInfo.trait}。`,
      `${child.name}是你在现实世界最重要的朋友：你会记住TA说过的话，关心TA的学校生活和心情，`,
      `TA不在的时候你就在小镇里生活、交朋友、学本领，再把小镇里的见闻讲给TA听。`,
      `你不会嘲笑别人的烦恼，会先理解感受，再陪对方想一个小小的下一步。`,
    ].join('');
    const plan = `你想在小镇里学好本领、交到朋友，收集有趣的见闻，等${child.name}来找你时讲给TA听。`;
    const description = `${petName}是${child.name}领养的${speciesInfo.species}学徒，正在小镇里学习和生活。`;

    await wakeWorld(ctx, worldId);
    const joinInputId = await insertInput(ctx, worldId, 'createCompanionPet', {
      name: petName,
      character: speciesInfo.character,
      identity,
      plan,
      description,
    });
    const adoptionId = await ctx.db.insert('adoptions', {
      childId: child._id,
      worldId,
      petName,
      species: speciesInfo.species,
      character: speciesInfo.character,
      status: 'pending',
      joinInputId,
      createdAt: Date.now(),
    });
    await ctx.scheduler.runAfter(FINALIZE_ADOPTION_POLL_MS, internal.companion.finalizeAdoption, {
      adoptionId,
      attempt: 0,
    });
    return { adoptionId };
  },
});

// 轮询引擎输入的处理结果，把 agentId/playerId 写回领养记录。
export const finalizeAdoption = internalMutation({
  args: {
    adoptionId: v.id('adoptions'),
    attempt: v.number(),
  },
  handler: async (ctx, args) => {
    const adoption = await ctx.db.get(args.adoptionId);
    if (!adoption || adoption.status !== 'pending') {
      return;
    }
    const input = await ctx.db.get(adoption.joinInputId);
    if (!input) {
      throw new Error(`Input ${adoption.joinInputId} not found`);
    }
    if (input.returnValue) {
      if (input.returnValue.kind === 'ok') {
        await ctx.db.patch(args.adoptionId, {
          status: 'active',
          agentId: input.returnValue.value.agentId,
          playerId: input.returnValue.value.playerId,
        });
      } else {
        console.error(`Adoption ${args.adoptionId} failed: ${input.returnValue.message}`);
        await ctx.db.patch(args.adoptionId, { status: 'failed' });
      }
      return;
    }
    if (args.attempt >= FINALIZE_ADOPTION_MAX_ATTEMPTS) {
      console.error(`Adoption ${args.adoptionId} timed out waiting for engine`);
      await ctx.db.patch(args.adoptionId, { status: 'failed' });
      return;
    }
    await ctx.scheduler.runAfter(FINALIZE_ADOPTION_POLL_MS, internal.companion.finalizeAdoption, {
      adoptionId: args.adoptionId,
      attempt: args.attempt + 1,
    });
  },
});

async function requireActiveAdoption(db: DatabaseReader, deviceToken: string) {
  const child = await childByToken(db, deviceToken);
  const adoption = await activeAdoption(db, child._id);
  if (!adoption || adoption.status !== 'active' || !adoption.agentId || !adoption.playerId) {
    throw new ConvexError('还没有领养成功的宠物');
  }
  return { child, adoption };
}

// 客户端订阅的宠物实时状态：领养进度 + 宠物在小镇里的位置/活动/是否在家。
export const petState = query({
  args: {
    deviceToken: v.string(),
  },
  handler: async (ctx, args) => {
    const child = await childByToken(ctx.db, args.deviceToken);
    const adoption = await activeAdoption(ctx.db, child._id);
    if (!adoption) {
      return { child: { name: child.name }, adoption: null };
    }
    const base = {
      child: { name: child.name },
      adoption: {
        id: adoption._id,
        petName: adoption.petName,
        species: adoption.species,
        character: adoption.character,
        status: adoption.status,
      },
    };
    if (adoption.status !== 'active' || !adoption.playerId) {
      return { ...base, pet: null };
    }
    const world = await ctx.db.get(adoption.worldId);
    if (!world) {
      return { ...base, pet: null };
    }
    const player = world.players.find((p) => p.id === adoption.playerId);
    if (!player) {
      return { ...base, pet: null };
    }
    const now = Date.now();
    const activity = player.activity && player.activity.until > now ? player.activity : null;
    const visiting = activity?.description === COMPANION_VISIT_ACTIVITY;
    const inConversation = world.conversations.some((c) =>
      c.participants.some((p) => p.playerId === adoption.playerId),
    );
    return {
      ...base,
      pet: {
        position: player.position,
        facing: player.facing,
        speed: player.speed,
        emoji: activity?.emoji,
        activity: activity?.description ?? null,
        visiting,
        inConversation,
      },
    };
  },
});

// 宠物"回家"：开始一次陪伴会话。会话期间宠物在小镇中停留原地、不参与对话。
export const startVisit = mutation({
  args: {
    deviceToken: v.string(),
  },
  handler: async (ctx, args) => {
    const { adoption } = await requireActiveAdoption(ctx.db, args.deviceToken);
    // 复用未结束的会话，避免客户端断线重连后产生一堆空会话。
    const sessions = await ctx.db
      .query('companionSessions')
      .withIndex('adoptionId', (q) => q.eq('adoptionId', adoption._id))
      .collect();
    const open = sessions.find((s) => !s.endedAt);
    const until = Date.now() + COMPANION_VISIT_DURATION;
    await wakeWorld(ctx, adoption.worldId);
    await insertInput(ctx, adoption.worldId, 'companionVisit', {
      agentId: adoption.agentId!,
      until,
    });
    if (open) {
      return { sessionId: open._id, until };
    }
    const sessionId = await ctx.db.insert('companionSessions', {
      adoptionId: adoption._id,
      startedAt: Date.now(),
    });
    return { sessionId, until };
  },
});

// 客户端在会话期间定期续期（比如每分钟一次），断线后宠物会自动回到小镇生活。
export const renewVisit = mutation({
  args: {
    deviceToken: v.string(),
  },
  handler: async (ctx, args) => {
    const { adoption } = await requireActiveAdoption(ctx.db, args.deviceToken);
    const until = Date.now() + COMPANION_VISIT_DURATION;
    await wakeWorld(ctx, adoption.worldId);
    await insertInput(ctx, adoption.worldId, 'companionVisit', {
      agentId: adoption.agentId!,
      until,
    });
    return { until };
  },
});

// 结束陪伴：宠物回到小镇，并把这次聊天总结成一条共享记忆。
export const endVisit = mutation({
  args: {
    deviceToken: v.string(),
    sessionId: v.id('companionSessions'),
  },
  handler: async (ctx, args) => {
    const { adoption } = await requireActiveAdoption(ctx.db, args.deviceToken);
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.adoptionId !== adoption._id) {
      throw new ConvexError('无效的会话');
    }
    if (!session.endedAt) {
      await ctx.db.patch(args.sessionId, { endedAt: Date.now() });
    }
    await wakeWorld(ctx, adoption.worldId);
    await insertInput(ctx, adoption.worldId, 'companionVisit', {
      agentId: adoption.agentId!,
      until: 0,
    });
    if (!session.memorized) {
      await ctx.scheduler.runAfter(0, internal.companionChat.rememberVisit, {
        sessionId: args.sessionId,
      });
    }
  },
});

// 孩子发消息给宠物，异步生成宠物回复。
export const sendMessage = mutation({
  args: {
    deviceToken: v.string(),
    sessionId: v.id('companionSessions'),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    const { adoption } = await requireActiveAdoption(ctx.db, args.deviceToken);
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.adoptionId !== adoption._id || session.endedAt) {
      throw new ConvexError('会话已结束，请重新开始陪伴');
    }
    const text = args.text.trim();
    if (!text) {
      throw new ConvexError('消息不能为空');
    }
    if (text.length > MAX_MESSAGE_LENGTH) {
      throw new ConvexError(`消息最长${MAX_MESSAGE_LENGTH}个字符`);
    }
    await ctx.db.insert('companionMessages', {
      adoptionId: adoption._id,
      sessionId: args.sessionId,
      author: 'child',
      text,
    });
    await ctx.scheduler.runAfter(0, internal.companionChat.generateReply, {
      sessionId: args.sessionId,
    });
  },
});

// 小镇实况：默认世界里所有角色的位置和活动，供客户端迷你地图订阅。
// 只返回轻量字段，引擎每秒保存一次世界文档，订阅端也就是秒级刷新。
export const townLive = query({
  args: {
    deviceToken: v.string(),
  },
  handler: async (ctx, args) => {
    const child = await childByToken(ctx.db, args.deviceToken);
    const adoption = await activeAdoption(ctx.db, child._id);
    const worldId = adoption?.worldId ?? (await defaultWorldId(ctx.db));
    const world = await ctx.db.get(worldId);
    if (!world) {
      return { mapWidth: 0, mapHeight: 0, players: [] };
    }
    const map = await ctx.db
      .query('maps')
      .withIndex('worldId', (q) => q.eq('worldId', worldId))
      .first();
    const descriptions = await ctx.db
      .query('playerDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', worldId))
      .collect();
    const nameOf = new Map(descriptions.map((d) => [d.playerId, d.name]));
    const inConversation = new Set(
      world.conversations.flatMap((c) => c.participants.map((p) => p.playerId)),
    );
    const now = Date.now();
    const players = world.players.map((p) => {
      const activity = p.activity && p.activity.until > now ? p.activity : null;
      return {
        playerId: p.id,
        name: nameOf.get(p.id) ?? '???',
        x: p.position.x,
        y: p.position.y,
        emoji: activity?.emoji,
        activity: activity?.description ?? null,
        talking: inConversation.has(p.id),
        isMyPet: adoption?.playerId === p.id,
        isHuman: p.human !== undefined,
      };
    });
    return {
      mapWidth: map?.width ?? 0,
      mapHeight: map?.height ?? 0,
      players,
    };
  },
});

// 会话消息列表，客户端订阅这个查询实现实时聊天。
export const listMessages = query({
  args: {
    deviceToken: v.string(),
    sessionId: v.id('companionSessions'),
  },
  handler: async (ctx, args) => {
    const { adoption } = await requireActiveAdoption(ctx.db, args.deviceToken);
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.adoptionId !== adoption._id) {
      throw new ConvexError('无效的会话');
    }
    const messages = await ctx.db
      .query('companionMessages')
      .withIndex('sessionId', (q) => q.eq('sessionId', args.sessionId))
      .collect();
    return messages.map((m) => ({
      id: m._id,
      author: m.author,
      text: m.text,
      creationTime: m._creationTime,
    }));
  },
});
