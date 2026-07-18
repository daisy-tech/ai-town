import { v } from 'convex/values';
import { internalMutation } from './_generated/server';
import { GameId, playerId } from './aiTown/ids';
import { mirrorLegacyMemory, recordCompanionMessageEvent } from './townMind/events';

// DB writes used by the companionChat actions.

export const writePetMessage = internalMutation({
  args: {
    sessionId: v.id('companionSessions'),
    adoptionId: v.id('adoptions'),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    // The child may have ended the visit while the LLM was generating; still
    // record the farewell so the transcript is complete.
    if (!session) {
      return;
    }
    await ctx.db.insert('companionMessages', {
      adoptionId: args.adoptionId,
      sessionId: args.sessionId,
      author: 'pet',
      text: args.text,
    });
    // TownMind P1: mirror the raw message into the evidence log (child-private,
    // 90-day expiry on the text).
    try {
      const adoption = await ctx.db.get(args.adoptionId);
      if (adoption?.playerId) {
        await recordCompanionMessageEvent(ctx, {
          ownerPlayerId: adoption.playerId as GameId<'players'>,
          author: 'pet',
          text: args.text,
          childId: adoption.childId,
          adoptionId: args.adoptionId,
          sessionId: args.sessionId,
        });
      }
    } catch (e) {
      console.error('TownMind event write failed for pet message', e);
    }
  },
});

export const markSessionMemorized = internalMutation({
  args: {
    sessionId: v.id('companionSessions'),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sessionId, { memorized: true });
  },
});

// 把陪伴聊天总结写入宠物的共享记忆空间（memories + memoryEmbeddings），
// 让宠物回到小镇后也能"记得"和小主人的聊天。
export const insertVisitMemory = internalMutation({
  args: {
    playerId,
    childId: v.id('children'),
    description: v.string(),
    importance: v.number(),
    embedding: v.array(v.float64()),
  },
  handler: async (ctx, args) => {
    const embeddingId = await ctx.db.insert('memoryEmbeddings', {
      playerId: args.playerId,
      embedding: args.embedding,
    });
    await ctx.db.insert('memories', {
      playerId: args.playerId,
      description: args.description,
      embeddingId,
      importance: args.importance,
      lastAccess: Date.now(),
      // Child-private: retrievable only in this pet's companion sessions,
      // never in town conversations or reflections.
      scope: 'child_private',
      data: {
        type: 'companionChat',
        childId: args.childId,
      },
    });
    // TownMind P1 dual-write (shadow system; not user-visible yet).
    try {
      await mirrorLegacyMemory(ctx, {
        ownerPlayerId: args.playerId as GameId<'players'>,
        description: args.description,
        importance: args.importance,
        embedding: args.embedding,
        eventTime: Date.now(),
        scope: 'child_private',
        data: { type: 'companionChat', childId: args.childId },
      });
    } catch (e) {
      console.error('TownMind mirror failed for visit memory', e);
    }
  },
});
