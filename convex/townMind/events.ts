import { Id } from '../_generated/dataModel';
import { MutationCtx } from '../_generated/server';
import { GameId } from '../aiTown/ids';
import { COMPANION_RAW_CHAT_MAX_AGE } from '../constants';

type ConversationGameId = GameId<'conversations'>;

// TownMind P1 write path: an immutable evidence log (`memoryEvents`) plus a
// deterministic "mirror" that dual-writes every legacy memory into the new
// derived tables (claims / episodes / narratives) and the new vector table.
// No extra LLM calls: the mirror reuses the summary text and embedding the
// legacy pipeline already produced. This populates the new system so shadow
// retrieval (see ./shadow.ts) has real data to compare against.

// Dual-write is opt-in (`npx convex env set TOWNMIND_DUAL_WRITE 1`): the
// extra inserts + search/vector index writes measurably load a 4GB host, so
// they stay off until we're ready to collect shadow-eval data.
function dualWriteEnabled(): boolean {
  return process.env.TOWNMIND_DUAL_WRITE === '1';
}

// FNV-1a 32-bit hash. Mutations can't use node crypto; this is only used for
// idempotency keys, not security.
export function contentHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export interface RecordEventArgs {
  ownerPlayerId: GameId<'players'>;
  kind: 'message' | 'observation' | 'action' | 'correction' | 'deletion';
  channel: 'companion' | 'town' | 'system';
  scope: 'town' | 'child_private';
  sensitivity?: 'normal' | 'sensitive';
  speakerId?: string;
  childId?: Id<'children'>;
  adoptionId?: Id<'adoptions'>;
  sessionId?: Id<'companionSessions'>;
  conversationId?: string;
  eventTime: number;
  normalizedText?: string;
  expiresAt?: number;
}

// Append an event to the evidence log. Idempotent on
// (owner, kind, text, eventTime): re-running a failed action won't duplicate.
// Returns the event id, or null if an identical event already exists.
export async function recordMemoryEvent(
  ctx: MutationCtx,
  args: RecordEventArgs,
): Promise<Id<'memoryEvents'> | null> {
  const hash = contentHash(
    [args.ownerPlayerId, args.kind, args.normalizedText ?? '', args.eventTime].join('|'),
  );
  const existing = await ctx.db
    .query('memoryEvents')
    .withIndex('ownerHash', (q) => q.eq('ownerPlayerId', args.ownerPlayerId).eq('contentHash', hash))
    .first();
  if (existing) {
    return null;
  }
  return await ctx.db.insert('memoryEvents', {
    ownerPlayerId: args.ownerPlayerId,
    kind: args.kind,
    channel: args.channel,
    scope: args.scope,
    sensitivity: args.sensitivity ?? 'normal',
    speakerId: args.speakerId,
    childId: args.childId,
    adoptionId: args.adoptionId,
    sessionId: args.sessionId,
    conversationId: args.conversationId as ConversationGameId | undefined,
    eventTime: args.eventTime,
    normalizedText: args.normalizedText,
    contentHash: hash,
    expiresAt: args.expiresAt,
    status: 'active',
  });
}

// Record one raw companion chat message (child or pet). Raw child-channel
// text is the only content with a hard retention limit: it expires at 90
// days and the retention job redacts the text (metadata is kept).
export async function recordCompanionMessageEvent(
  ctx: MutationCtx,
  args: {
    ownerPlayerId: GameId<'players'>;
    author: 'child' | 'pet';
    text: string;
    childId: Id<'children'>;
    adoptionId: Id<'adoptions'>;
    sessionId: Id<'companionSessions'>;
  },
): Promise<void> {
  if (!dualWriteEnabled()) {
    return;
  }
  const now = Date.now();
  await recordMemoryEvent(ctx, {
    ownerPlayerId: args.ownerPlayerId,
    kind: 'message',
    channel: 'companion',
    scope: 'child_private',
    speakerId: args.author === 'child' ? `child:${args.childId}` : args.ownerPlayerId,
    childId: args.childId,
    adoptionId: args.adoptionId,
    sessionId: args.sessionId,
    eventTime: now,
    normalizedText: args.text,
    expiresAt: now + COMPANION_RAW_CHAT_MAX_AGE,
  });
}

// Legacy memory data union (same shape as convex/agent/schema.ts memoryFields.data).
type LegacyMemoryData =
  | { type: 'relationship'; playerId: string }
  | { type: 'conversation'; conversationId: string; playerIds: string[] }
  | { type: 'reflection'; relatedMemoryIds: Id<'memories'>[] }
  | { type: 'companionChat'; childId: Id<'children'> };

export interface MirrorMemoryArgs {
  ownerPlayerId: GameId<'players'>;
  description: string;
  importance: number;
  embedding: number[];
  eventTime: number;
  scope: 'town' | 'child_private';
  data: LegacyMemoryData;
}

function filterKeyFor(
  ownerPlayerId: string,
  scope: 'town' | 'child_private',
  childId?: Id<'children'>,
): string {
  return scope === 'child_private' && childId
    ? `${ownerPlayerId}|child:${childId}`
    : `${ownerPlayerId}|town`;
}

// Dual-write a legacy memory into the TownMind model:
//   conversation / companionChat → memoryEpisodes (hot tier)
//   relationship               → memoryClaims (fact)
//   reflection                 → memoryNarratives (reflection)
// plus a source event and a vector row. Idempotent via the event log: if the
// source event already exists, the memory was mirrored before and we skip.
export async function mirrorLegacyMemory(ctx: MutationCtx, args: MirrorMemoryArgs): Promise<void> {
  if (!dualWriteEnabled()) {
    return;
  }
  const now = Date.now();
  const childId = args.data.type === 'companionChat' ? args.data.childId : undefined;
  const eventId = await recordMemoryEvent(ctx, {
    ownerPlayerId: args.ownerPlayerId,
    kind: 'observation',
    channel: args.data.type === 'companionChat' ? 'companion' : 'town',
    scope: args.scope,
    childId,
    conversationId: args.data.type === 'conversation' ? args.data.conversationId : undefined,
    eventTime: args.eventTime,
    normalizedText: args.description,
    // Derived summaries have no 90-day expiry; they are managed by value
    // tiering and (in P3) child/guardian deletion.
  });
  if (eventId === null) {
    return;
  }
  const sourceEventIds = [eventId];

  let memoryType: 'claim' | 'episode' | 'narrative';
  let memoryId: string;
  switch (args.data.type) {
    case 'conversation':
    case 'companionChat': {
      memoryType = 'episode';
      const participantIds =
        args.data.type === 'conversation'
          ? [args.ownerPlayerId, ...args.data.playerIds]
          : [args.ownerPlayerId, `child:${args.data.childId}`];
      memoryId = await ctx.db.insert('memoryEpisodes', {
        ownerPlayerId: args.ownerPlayerId,
        participantIds,
        eventTimeStart: args.eventTime,
        eventTimeEnd: args.eventTime,
        // P2's extraction pipeline produces real titles; the mirror derives a
        // cheap one from the summary head.
        title: args.description.slice(0, 24),
        summary: args.description,
        importance: args.importance,
        scope: args.scope,
        sensitivity: 'normal',
        childId,
        sourceEventIds,
        tier: 'hot',
        status: 'active',
      });
      break;
    }
    case 'relationship': {
      memoryType = 'claim';
      memoryId = await ctx.db.insert('memoryClaims', {
        ownerPlayerId: args.ownerPlayerId,
        subjectId: args.data.playerId,
        predicate: 'relationship_fact',
        objectValue: args.description,
        text: args.description,
        claimType: 'fact',
        scope: args.scope,
        sensitivity: 'normal',
        validFrom: args.eventTime,
        learnedAt: now,
        // Legacy extraction has no per-fact confidence; use a neutral default.
        confidence: 0.7,
        sourceEventIds,
        status: 'active',
      });
      break;
    }
    case 'reflection': {
      memoryType = 'narrative';
      memoryId = await ctx.db.insert('memoryNarratives', {
        ownerPlayerId: args.ownerPlayerId,
        kind: 'reflection',
        text: args.description,
        importance: args.importance,
        scope: args.scope,
        sensitivity: 'normal',
        sourceRefs: args.data.relatedMemoryIds.map((id) => `memories:${id}`),
        generatorVersion: 'legacy-mirror-1',
        status: 'active',
      });
      break;
    }
  }

  await ctx.db.insert('townMemoryEmbeddings', {
    ownerPlayerId: args.ownerPlayerId,
    memoryType,
    memoryId,
    scope: args.scope,
    childId,
    filterKey: filterKeyFor(args.ownerPlayerId, args.scope, childId),
    // The mirror reuses the legacy pipeline's embedding (same model/dims);
    // P2 re-embeds hot items at 512 dims with a real model tag.
    embeddingModel: 'legacy-shared',
    embeddingVersion: 1,
    embedding: args.embedding,
  });
}
