import { query } from './_generated/server';
import { v } from 'convex/values';

// 获取所有角色的列表
export const listAllPlayers = query({
  args: {},
  handler: async (ctx) => {
    const playerDescriptions = await ctx.db
      .query('playerDescriptions')
      .collect();

    return playerDescriptions.map((p) => ({
      playerId: p.playerId,
      name: p.name,
      description: p.description,
    }));
  },
});

// 获取所有记忆（支持分页和过滤）
export const getAllMemories = query({
  args: {
    playerName: v.optional(v.string()),
    memoryType: v.optional(v.union(
      v.literal('conversation'),
      v.literal('reflection'),
      v.literal('relationship')
    )),
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 50;
    const offset = args.offset || 0;

    // 如果指定了角色名称，先查找角色
    let targetPlayerId: string | undefined;
    if (args.playerName) {
      const playerDescription = await ctx.db
        .query('playerDescriptions')
        .filter(q => q.eq(q.field('name'), args.playerName))
        .first();

      if (!playerDescription) {
        return { error: `未找到角色: ${args.playerName}`, memories: [], total: 0 };
      }
      targetPlayerId = playerDescription.playerId;
    }

    // 构建查询（分支写，避免 withIndex 返回类型与 QueryInitializer 不兼容）
    let allMemories;
    if (targetPlayerId && args.memoryType) {
      const playerId = targetPlayerId;
      const memoryType = args.memoryType;
      allMemories = await ctx.db
        .query('memories')
        .withIndex('playerId_type', (q) =>
          q.eq('playerId', playerId).eq('data.type', memoryType),
        )
        .order('desc')
        .collect();
    } else if (targetPlayerId) {
      const playerId = targetPlayerId;
      allMemories = await ctx.db
        .query('memories')
        .withIndex('playerId', (q) => q.eq('playerId', playerId))
        .order('desc')
        .collect();
    } else {
      allMemories = await ctx.db.query('memories').order('desc').collect();
    }

    // 如果只按类型过滤，需要在内存中过滤
    let filteredMemories = allMemories;
    if (!targetPlayerId && args.memoryType) {
      filteredMemories = allMemories.filter((m) => m.data.type === args.memoryType);
    }

    const total = filteredMemories.length;
    const memories = filteredMemories.slice(offset, offset + limit);

    // 获取所有相关的角色信息
    const playerIds = new Set(memories.map(m => m.playerId));
    const playerDescriptions = await ctx.db
      .query('playerDescriptions')
      .collect();

    const playerMap = new Map(
      playerDescriptions.map(p => [p.playerId, p.name])
    );

    // 格式化记忆数据
    const formattedMemories = await Promise.all(
      memories.map(async (memory) => {
        const base = {
          _id: memory._id,
          playerId: memory.playerId,
          playerName: playerMap.get(memory.playerId) || '未知',
          description: memory.description,
          importance: memory.importance,
          type: memory.data.type,
          createdAt: new Date(memory._creationTime).toLocaleString('zh-CN'),
          lastAccess: new Date(memory.lastAccess).toLocaleString('zh-CN'),
        };

        // 根据类型添加额外信息
        if (memory.data.type === 'conversation') {
          const otherPlayerNames = await Promise.all(
            memory.data.playerIds.map(async (pid) => {
              const desc = await ctx.db
                .query('playerDescriptions')
                .filter(q => q.eq(q.field('playerId'), pid))
                .first();
              return desc?.name || '未知';
            })
          );
          return {
            ...base,
            conversationId: memory.data.conversationId,
            otherPlayers: otherPlayerNames,
          };
        } else if (memory.data.type === 'reflection') {
          return {
            ...base,
            relatedMemoryCount: memory.data.relatedMemoryIds.length,
          };
        } else if (memory.data.type === 'relationship') {
          const relatedPlayerId = memory.data.playerId;
          const otherPlayerDesc = await ctx.db
            .query('playerDescriptions')
            .filter((q) => q.eq(q.field('playerId'), relatedPlayerId))
            .first();
          return {
            ...base,
            aboutPlayer: otherPlayerDesc?.name || '未知',
          };
        }

        return base;
      })
    );

    return {
      memories: formattedMemories,
      total,
      offset,
      limit,
    };
  },
});

// 获取记忆统计信息
export const getMemoryStats = query({
  args: {},
  handler: async (ctx) => {
    const memories = await ctx.db.query('memories').collect();
    const players = await ctx.db.query('playerDescriptions').collect();

    // 按类型统计
    const typeStats = {
      conversation: memories.filter(m => m.data.type === 'conversation').length,
      reflection: memories.filter(m => m.data.type === 'reflection').length,
      relationship: memories.filter(m => m.data.type === 'relationship').length,
    };

    // 按角色统计
    const playerStats = players.map(player => {
      const playerMemories = memories.filter(m => m.playerId === player.playerId);
      return {
        playerName: player.name,
        playerId: player.playerId,
        totalMemories: playerMemories.length,
        conversations: playerMemories.filter(m => m.data.type === 'conversation').length,
        reflections: playerMemories.filter(m => m.data.type === 'reflection').length,
        avgImportance: playerMemories.length > 0
          ? (playerMemories.reduce((sum, m) => sum + m.importance, 0) / playerMemories.length).toFixed(2)
          : 0,
      };
    });

    // 总体统计
    const totalImportance = memories.reduce((sum, m) => sum + m.importance, 0);
    const avgImportance = memories.length > 0 ? (totalImportance / memories.length).toFixed(2) : 0;

    // 最近的记忆
    const recentMemories = memories
      .sort((a, b) => b._creationTime - a._creationTime)
      .slice(0, 5)
      .map(m => ({
        playerName: players.find(p => p.playerId === m.playerId)?.name || '未知',
        type: m.data.type,
        description: m.description.substring(0, 100) + '...',
        createdAt: new Date(m._creationTime).toLocaleString('zh-CN'),
      }));

    return {
      total: memories.length,
      typeStats,
      playerStats,
      avgImportance,
      recentMemories,
    };
  },
});

// 获取记忆详情
export const getMemoryDetail = query({
  args: {
    memoryId: v.id('memories'),
  },
  handler: async (ctx, args) => {
    const memory = await ctx.db.get(args.memoryId);
    if (!memory) {
      return { error: '记忆不存在' };
    }

    const playerDesc = await ctx.db
      .query('playerDescriptions')
      .filter(q => q.eq(q.field('playerId'), memory.playerId))
      .first();

    const base = {
      _id: memory._id,
      playerId: memory.playerId,
      playerName: playerDesc?.name || '未知',
      description: memory.description,
      importance: memory.importance,
      type: memory.data.type,
      createdAt: new Date(memory._creationTime).toLocaleString('zh-CN'),
      lastAccess: new Date(memory.lastAccess).toLocaleString('zh-CN'),
      embeddingId: memory.embeddingId,
    };

    // 根据类型获取详细信息
    if (memory.data.type === 'conversation') {
      const otherPlayers = await Promise.all(
        memory.data.playerIds.map(async (pid) => {
          const desc = await ctx.db
            .query('playerDescriptions')
            .filter(q => q.eq(q.field('playerId'), pid))
            .first();
          return {
            playerId: pid,
            name: desc?.name || '未知',
          };
        })
      );

      return {
        ...base,
        conversationId: memory.data.conversationId,
        otherPlayers,
      };
    } else if (memory.data.type === 'reflection') {
      // 获取关联的记忆
      const relatedMemories = await Promise.all(
        memory.data.relatedMemoryIds.map(async (id) => {
          const m = await ctx.db.get(id);
          if (!m) return null;
          return {
            _id: m._id,
            description: m.description.substring(0, 100) + '...',
            type: m.data.type,
          };
        })
      );

      return {
        ...base,
        relatedMemories: relatedMemories.filter(m => m !== null),
      };
    } else if (memory.data.type === 'relationship') {
      const relatedPlayerId = memory.data.playerId;
      const otherPlayerDesc = await ctx.db
        .query('playerDescriptions')
        .filter((q) => q.eq(q.field('playerId'), relatedPlayerId))
        .first();

      return {
        ...base,
        aboutPlayer: {
          playerId: relatedPlayerId,
          name: otherPlayerDesc?.name || '未知',
        },
      };
    }

    return base;
  },
});
