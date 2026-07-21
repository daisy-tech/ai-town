import { defineTable } from 'convex/server';
import { v } from 'convex/values';
import { agentId, playerId } from './aiTown/ids';

// Tables backing the "companion" layer: children adopting exclusive
// apprentice pets and chatting with them from the macOS client. The pet's
// mind (identity + memories) lives in the shared town tables; these tables
// only add the child identity, the adoption link, and the client-side chat
// transcript.
export const companionTables = {
  // A guardian account, identified by a Chinese mobile number. Owns one or
  // more child profiles (and through them, pets); logging in on any device
  // with the phone number recovers everything. The phone number is only ever
  // stored here — never in memories or prompts.
  accounts: defineTable({
    phone: v.string(),
    createdAt: v.number(),
  }).index('phone', ['phone']),

  // One-time login codes. Test mode: the code is returned to the client and
  // shown on screen (no SMS provider wired up yet); switching to real SMS
  // later only changes requestCode, not this table.
  smsCodes: defineTable({
    phone: v.string(),
    code: v.string(),
    expiresAt: v.number(),
    attempts: v.number(),
    usedAt: v.optional(v.number()),
  }).index('phone', ['phone']),

  // A logged-in device. The token is the client's credential for every
  // companion API call; logout deletes the row. `currentChildId` is which of
  // the account's child profiles (= which pet) this device is looking at.
  authSessions: defineTable({
    token: v.string(),
    accountId: v.id('accounts'),
    currentChildId: v.optional(v.id('children')),
    createdAt: v.number(),
    lastActiveAt: v.number(),
  })
    .index('token', ['token'])
    .index('accountId', ['accountId']),

  // A child profile. Belongs to an account (accountId); each profile has at
  // most one active pet. `deviceToken` is the legacy pre-account credential:
  // kept for old rows, no longer issued or accepted.
  children: defineTable({
    name: v.string(),
    deviceToken: v.optional(v.string()),
    accountId: v.optional(v.id('accounts')),
    createdAt: v.number(),
  })
    .index('deviceToken', ['deviceToken'])
    .index('accountId', ['accountId']),

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
