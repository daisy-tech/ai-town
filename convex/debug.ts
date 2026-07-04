import { query } from './_generated/server';
import { v } from 'convex/values';

// 查询指定角色的所有记忆
export const getPlayerMemories = query({
  args: {
    worldId: v.id('worlds'),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const world = await ctx.db.get(args.worldId);
    if (!world) {
      throw new Error('World not found');
    }

    const limit = args.limit || 100;

    // 获取所有记忆，按创建时间降序
    const memories = await ctx.db
      .query('memories')
      .withIndex('by_creation_time')
      .order('desc')
      .take(limit);

    // 获取角色信息
    const playerIds = new Set(memories.map(m => m.playerId));
    const players = await Promise.all(
      Array.from(playerIds).map(async (playerId) => {
        const playerDoc = world.players.find((p: any) => p.id === playerId);
        if (!playerDoc) return null;

        const playerDescription = await ctx.db
          .query('playerDescriptions')
          .filter(q => q.eq(q.field('playerId'), playerId))
          .first();

        return {
          playerId,
          name: playerDescription?.name || '未知',
        };
      })
    );

    const playerMap = new Map(
      players.filter(p => p !== null).map(p => [p!.playerId, p!.name])
    );

    // 格式化记忆数据
    const formattedMemories = memories.map((memory) => ({
      playerId: memory.playerId,
      playerName: playerMap.get(memory.playerId) || '未知',
      description: memory.description,
      importance: memory.importance,
      type: memory.data.type,
      createdAt: new Date(memory._creationTime).toLocaleString('zh-CN'),
      embeddingId: memory.embeddingId,
    }));

    return {
      total: formattedMemories.length,
      memories: formattedMemories,
    };
  },
});

// 按角色名称查询记忆
export const getMemoriesByPlayerName = query({
  args: {
    worldId: v.id('worlds'),
    playerName: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const world = await ctx.db.get(args.worldId);
    if (!world) {
      throw new Error('World not found');
    }

    // 查找角色
    const playerDescription = await ctx.db
      .query('playerDescriptions')
      .filter(q => q.eq(q.field('name'), args.playerName))
      .first();

    if (!playerDescription) {
      return {
        error: `未找到角色: ${args.playerName}`,
        availablePlayers: await getAvailablePlayers(ctx, args.worldId),
      };
    }

    const limit = args.limit || 50;

    // 获取该角色的所有记忆
    const memories = await ctx.db
      .query('memories')
      .withIndex('playerId', q => q.eq('playerId', playerDescription.playerId))
      .order('desc')
      .take(limit);

    const formattedMemories = memories.map((memory) => ({
      description: memory.description,
      importance: memory.importance,
      type: memory.data.type,
      createdAt: new Date(memory._creationTime).toLocaleString('zh-CN'),
      // 如果是对话记忆，显示对话参与者
      participants: memory.data.type === 'conversation'
        ? memory.data.playerIds
        : undefined,
    }));

    return {
      playerName: args.playerName,
      playerId: playerDescription.playerId,
      total: formattedMemories.length,
      memories: formattedMemories,
    };
  },
});

// 获取所有可用的角色列表
async function getAvailablePlayers(ctx: any, worldId: any) {
  const playerDescriptions = await ctx.db
    .query('playerDescriptions')
    .collect();

  return playerDescriptions.map((p: any) => ({
    name: p.name,
    playerId: p.playerId,
  }));
}

export const listPlayers = query({
  args: {
    worldId: v.id('worlds'),
  },
  handler: async (ctx, args) => {
    return await getAvailablePlayers(ctx, args.worldId);
  },
});
