import { v } from 'convex/values';
import { playerId, conversationId } from '../aiTown/ids';
import { defineTable } from 'convex/server';
import { EMBEDDING_DIMENSION } from '../util/llm';

// Visibility scope of a memory (TownMind P0).
//
// - `town`: normal town life; retrievable in NPC conversations and reflections.
// - `child_private`: derived from a child's companion chat. Only ever injected
//   into that pet's companion sessions — never into town conversations,
//   reflections, or other agents' prompts.
//
// The field is optional for backwards compatibility with rows written before
// this change; legacy rows fall back to their `data.type` (`companionChat`
// implies `child_private`, everything else is town-visible). See
// `memoryScopeOf` in ./memory.ts.
export const memoryScope = v.union(v.literal('town'), v.literal('child_private'));

export const memoryFields = {
  playerId,
  description: v.string(),
  embeddingId: v.id('memoryEmbeddings'),
  importance: v.number(),
  lastAccess: v.number(),
  scope: v.optional(memoryScope),
  data: v.union(
    // Setting up dynamics between players
    v.object({
      type: v.literal('relationship'),
      // The player this memory is about, from the perspective of the player
      // whose memory this is.
      playerId,
    }),
    v.object({
      type: v.literal('conversation'),
      conversationId,
      // The other player(s) in the conversation.
      playerIds: v.array(playerId),
    }),
    v.object({
      type: v.literal('reflection'),
      relatedMemoryIds: v.array(v.id('memories')),
    }),
    // A chat with the pet's adopted child through the companion client.
    // Stored in the same memory space as town memories, but always
    // child-private: only retrievable inside that pet's companion sessions,
    // never in town conversations or reflections.
    v.object({
      type: v.literal('companionChat'),
      childId: v.id('children'),
    }),
  ),
};
export const memoryTables = {
  memories: defineTable(memoryFields)
    .index('embeddingId', ['embeddingId'])
    .index('playerId_type', ['playerId', 'data.type'])
    .index('playerId', ['playerId']),
  memoryEmbeddings: defineTable({
    playerId,
    embedding: v.array(v.float64()),
  }).vectorIndex('embedding', {
    vectorField: 'embedding',
    filterFields: ['playerId'],
    dimensions: EMBEDDING_DIMENSION,
  }),
};

export const agentTables = {
  ...memoryTables,
  embeddingsCache: defineTable({
    textHash: v.bytes(),
    embedding: v.array(v.float64()),
  }).index('text', ['textHash']),
};
