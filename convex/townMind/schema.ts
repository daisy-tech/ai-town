import { v } from 'convex/values';
import { defineTable } from 'convex/server';
import { playerId, conversationId } from '../aiTown/ids';
import { memoryScope } from '../agent/schema';
import { EMBEDDING_DIMENSION } from '../util/llm';

// TownMind P1: the new memory data model. It runs alongside the legacy
// `memories`/`memoryEmbeddings` tables (dual-write, shadow-read) until the
// TownPet-MemEval gates pass; nothing here feeds user-visible answers yet.
//
// Deviations from the design doc, agreed for P1:
// - Owner identity is `ownerPlayerId` (the pet/NPC's stable player id), not
//   agentId: every existing memory path is keyed by playerId and agents map
//   1:1 to players. An optional agentId column can be added at migration time.
// - Embeddings reuse the current EMBEDDING_DIMENSION pipeline; the 512-dim
//   bounded vectors land in P2 (`embeddingModel`/`embeddingVersion` fields
//   exist so vectors can be regenerated without a schema change).

// Sensitivity classification. P1 only distinguishes "sensitive" (blocked from
// any future sanitized sharing) from normal; the full category taxonomy
// (safety/health/family/location) arrives with the P2 extraction pipeline.
export const sensitivityClass = v.union(v.literal('normal'), v.literal('sensitive'));

export const memoryEventKind = v.union(
  v.literal('message'),
  v.literal('observation'),
  v.literal('action'),
  v.literal('correction'),
  v.literal('deletion'),
);

export const memoryChannel = v.union(
  v.literal('companion'),
  v.literal('town'),
  v.literal('system'),
);

export const townMindTables = {
  // Immutable evidence log. Rows are never edited: corrections and deletions
  // are represented as new events. `expiresAt` drives the retention purge
  // (companion raw text: 90 days; derived observation events have no expiry
  // because they contain summaries, not raw child speech).
  memoryEvents: defineTable({
    ownerPlayerId: playerId,
    kind: memoryEventKind,
    channel: memoryChannel,
    scope: memoryScope,
    sensitivity: sensitivityClass,
    // Who produced the content (playerId, `child:<id>`, or 'system').
    speakerId: v.optional(v.string()),
    childId: v.optional(v.id('children')),
    adoptionId: v.optional(v.id('adoptions')),
    sessionId: v.optional(v.id('companionSessions')),
    conversationId: v.optional(conversationId),
    // When the thing actually happened (vs _creationTime = when we learned).
    eventTime: v.number(),
    normalizedText: v.optional(v.string()),
    // FNV-1a hash of (owner, kind, text, eventTime); used for idempotent writes.
    contentHash: v.string(),
    expiresAt: v.optional(v.number()),
    status: v.union(v.literal('active'), v.literal('redacted'), v.literal('deleted')),
  })
    .index('owner', ['ownerPlayerId', 'eventTime'])
    .index('sessionId', ['sessionId'])
    .index('ownerHash', ['ownerPlayerId', 'contentHash'])
    .index('expiresAt', ['expiresAt']),

  // Bitemporal derived facts. `text` is the rendered sentence used for
  // full-text recall and prompt injection.
  memoryClaims: defineTable({
    ownerPlayerId: playerId,
    // Entity the claim is about: a playerId, `child:<id>`, or a free-form name.
    subjectId: v.string(),
    predicate: v.string(),
    objectValue: v.string(),
    text: v.string(),
    claimType: v.union(
      v.literal('fact'),
      v.literal('preference'),
      v.literal('goal'),
      v.literal('commitment'),
      v.literal('inference'),
    ),
    scope: memoryScope,
    sensitivity: sensitivityClass,
    validFrom: v.number(),
    validTo: v.optional(v.number()),
    learnedAt: v.number(),
    confidence: v.number(),
    sourceEventIds: v.array(v.id('memoryEvents')),
    supersedes: v.optional(v.id('memoryClaims')),
    status: v.union(
      v.literal('active'),
      v.literal('superseded'),
      v.literal('disputed'),
      v.literal('deleted'),
    ),
  })
    .index('ownerSubject', ['ownerPlayerId', 'subjectId', 'status'])
    .index('ownerStatus', ['ownerPlayerId', 'status'])
    .searchIndex('search_text', {
      searchField: 'text',
      filterFields: ['ownerPlayerId', 'scope', 'status'],
    }),

  // Episodic memories ("what we did together").
  memoryEpisodes: defineTable({
    ownerPlayerId: playerId,
    // playerIds and/or `child:<id>` strings.
    participantIds: v.array(v.string()),
    eventTimeStart: v.number(),
    eventTimeEnd: v.number(),
    title: v.string(),
    summary: v.string(),
    emotion: v.optional(v.string()),
    importance: v.number(),
    scope: memoryScope,
    sensitivity: sensitivityClass,
    childId: v.optional(v.id('children')),
    sourceEventIds: v.array(v.id('memoryEvents')),
    // 'hot' episodes have a vector; consolidation demotes to 'warm' (indexed
    // access only) instead of deleting. 'cold' is reserved for the P3 archive.
    tier: v.union(v.literal('hot'), v.literal('warm'), v.literal('cold')),
    status: v.union(v.literal('active'), v.literal('superseded'), v.literal('deleted')),
  })
    .index('ownerTime', ['ownerPlayerId', 'eventTimeEnd'])
    .index('ownerTier', ['ownerPlayerId', 'tier'])
    .searchIndex('search_summary', {
      searchField: 'summary',
      filterFields: ['ownerPlayerId', 'scope', 'status'],
    }),

  // Strictly bounded always-in-prompt memory. Populated by the P2
  // consolidation pipeline and (for read_only safety rules) by ops.
  coreMemories: defineTable({
    ownerPlayerId: playerId,
    kind: v.union(v.literal('read_only'), v.literal('managed')),
    key: v.string(),
    content: v.string(),
    version: v.number(),
    updatedAt: v.number(),
    sourceDescription: v.optional(v.string()),
  }).index('owner', ['ownerPlayerId', 'key']),

  // Derived narrative artifacts (summaries, reflections). Always rebuildable
  // from sources; never the only copy of a fact.
  memoryNarratives: defineTable({
    ownerPlayerId: playerId,
    kind: v.union(
      v.literal('daily_summary'),
      v.literal('weekly_summary'),
      v.literal('relationship_summary'),
      v.literal('reflection'),
    ),
    // For relationship summaries: who it's about.
    subjectId: v.optional(v.string()),
    periodStart: v.optional(v.number()),
    periodEnd: v.optional(v.number()),
    text: v.string(),
    importance: v.number(),
    scope: memoryScope,
    sensitivity: sensitivityClass,
    // Loose references ("memories:<id>", "memoryEvents:<id>") since narratives
    // may cite either legacy or new-system sources during migration.
    sourceRefs: v.array(v.string()),
    generatorVersion: v.string(),
    status: v.union(v.literal('active'), v.literal('superseded'), v.literal('deleted')),
  })
    .index('ownerKind', ['ownerPlayerId', 'kind'])
    .searchIndex('search_text', {
      searchField: 'text',
      filterFields: ['ownerPlayerId', 'scope', 'status'],
    }),

  // Vectors for Hot-tier items only. Convex vector filters can't AND multiple
  // fields, so permission-first filtering uses a single composite `filterKey`:
  //   `${ownerPlayerId}|town`            — town-visible item
  //   `${ownerPlayerId}|child:${childId}` — child-private item
  // A town query filters on exactly the first key; a companion query ORs both.
  townMemoryEmbeddings: defineTable({
    ownerPlayerId: playerId,
    memoryType: v.union(v.literal('claim'), v.literal('episode'), v.literal('narrative')),
    // _id of the row in memoryClaims/memoryEpisodes/memoryNarratives.
    memoryId: v.string(),
    scope: memoryScope,
    childId: v.optional(v.id('children')),
    filterKey: v.string(),
    embeddingModel: v.string(),
    embeddingVersion: v.number(),
    embedding: v.array(v.float64()),
  })
    .index('owner', ['ownerPlayerId'])
    .index('memoryId', ['memoryId'])
    .vectorIndex('embedding', {
      vectorField: 'embedding',
      filterFields: ['filterKey'],
      dimensions: EMBEDDING_DIMENSION,
    }),

  // Shadow-mode comparison log: legacy retrieval vs TownMind retrieval for
  // the same query. Purged with the transient-data vacuum (3 days).
  memoryShadowRuns: defineTable({
    ownerPlayerId: playerId,
    audience: v.union(v.literal('town'), v.literal('companion')),
    childId: v.optional(v.id('children')),
    queryText: v.optional(v.string()),
    legacyResults: v.array(v.string()),
    townMindResults: v.array(
      v.object({
        type: v.string(),
        text: v.string(),
        score: v.number(),
      }),
    ),
    // How many legacy results also surfaced in the TownMind results.
    overlapCount: v.number(),
    latencyMs: v.number(),
    error: v.optional(v.string()),
  }).index('owner', ['ownerPlayerId']),
};
