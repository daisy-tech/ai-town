import { defineTable } from 'convex/server';
import { v } from 'convex/values';
import { agentId, playerId } from './aiTown/ids';

// Tables backing the "companion" layer: children adopting exclusive
// apprentice pets and chatting with them from the macOS client. The pet's
// mind (identity + memories) lives in the shared town tables; these tables
// only add the child identity, the adoption link, and the client-side chat
// transcript.
export const companionTables = {
  // A child using the client. Identified by a secret device token issued at
  // registration (no accounts / passwords in M1).
  children: defineTable({
    name: v.string(),
    deviceToken: v.string(),
    createdAt: v.number(),
  }).index('deviceToken', ['deviceToken']),

  // One active adoption per child. The pet is a full agent in the shared
  // world; agentId/playerId are filled in once the engine processes the
  // createCompanionPet input.
  adoptions: defineTable({
    childId: v.id('children'),
    worldId: v.id('worlds'),
    petName: v.string(),
    species: v.string(),
    character: v.string(),
    status: v.union(v.literal('pending'), v.literal('active'), v.literal('failed')),
    joinInputId: v.id('inputs'),
    agentId: v.optional(agentId),
    playerId: v.optional(playerId),
    createdAt: v.number(),
  })
    .index('childId', ['childId'])
    .index('playerId', ['worldId', 'playerId']),

  // A "visit": the pet comes home to the client while the child is online.
  // Messages within a session are summarized into the pet's shared memory
  // when the session ends.
  companionSessions: defineTable({
    adoptionId: v.id('adoptions'),
    startedAt: v.number(),
    endedAt: v.optional(v.number()),
    memorized: v.optional(v.boolean()),
    // Memory lines injected into the reply prompt, refreshed every few child
    // messages instead of on every message (saves an embedding API call and
    // a vector search per reply on the resource-constrained backend).
    memoryCache: v.optional(
      v.object({
        lines: v.array(v.string()),
        childMessageCount: v.number(),
      }),
    ),
  })
    .index('adoptionId', ['adoptionId'])
    // Used by the hourly sweeper to find sessions that still need memorizing
    // (memorized is undefined until rememberVisit succeeds).
    .index('memorized', ['memorized']),

  companionMessages: defineTable({
    adoptionId: v.id('adoptions'),
    sessionId: v.id('companionSessions'),
    author: v.union(v.literal('child'), v.literal('pet')),
    text: v.string(),
  })
    .index('sessionId', ['sessionId'])
    .index('adoptionId', ['adoptionId']),
};
