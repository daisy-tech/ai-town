import { cronJobs } from 'convex/server';
import {
  COMPANION_MEMORIZE_GRACE,
  COMPANION_RAW_CHAT_MAX_AGE,
  COMPANION_SESSION_STALE_AGE,
  DELETE_BATCH_SIZE,
  IDLE_WORLD_TIMEOUT,
  MAX_MEMORIES_PER_PLAYER,
  MEMORY_QUOTA_DELETE_CAP,
  VACUUM_MAX_AGE,
} from './constants';
import { internal } from './_generated/api';
import { internalMutation } from './_generated/server';
import { Id, TableNames } from './_generated/dataModel';
import { v } from 'convex/values';
import { playerId } from './aiTown/ids';

const crons = cronJobs();

crons.interval(
  'stop inactive worlds',
  { seconds: IDLE_WORLD_TIMEOUT / 1000 },
  internal.world.stopInactiveWorlds,
);

crons.interval('restart dead worlds', { seconds: 60 }, internal.world.restartDeadWorlds);

crons.daily('vacuum old entries', { hourUTC: 4, minuteUTC: 20 }, internal.crons.vacuumOldEntries);

// TownMind P0: raw child↔pet transcripts are deleted after 90 days (derived
// memories are kept); long-term memories are bounded by a per-player quota
// instead of an age-based vacuum.
crons.daily(
  'companion raw chat retention',
  { hourUTC: 4, minuteUTC: 40 },
  internal.crons.enforceCompanionRetention,
);
crons.daily(
  'enforce memory quota',
  { hourUTC: 5, minuteUTC: 0 },
  internal.crons.enforceMemoryQuota,
);
// TownMind evidence log: raw child-chat event text expires at 90 days. The
// row is kept (id, time, kind, hash — needed for provenance) but the text is
// irrecoverably removed.
crons.daily(
  'redact expired memory events',
  { hourUTC: 4, minuteUTC: 50 },
  internal.crons.redactExpiredMemoryEvents,
);

// Recover companion sessions whose summary never got written (client crash,
// LLM failure): close abandoned sessions and retry memorization.
crons.interval(
  'sweep stranded companion sessions',
  { hours: 1 },
  internal.crons.sweepStrandedCompanionSessions,
);

export default crons;

const TablesToVacuum: TableNames[] = [
  // Inputs aren't useful unless you're trying to replay history.
  // If you want to support that, you should add a snapshot table, so you can
  // replay from a certain time period. Or stop vacuuming inputs and replay from
  // the beginning of time
  'inputs',

  // NOTE: `memories` and `memoryEmbeddings` are intentionally NOT vacuumed.
  // They are the agents' long-term memory and are kept indefinitely; their
  // size (and the vector index) is bounded by `enforceMemoryQuota` below,
  // which trims the lowest-value memories per player instead of everything
  // older than 3 days.

  // Old transcripts and their bookkeeping. Agents keep the *summaries* of
  // these conversations as memories; the raw logs only feed the history
  // panel in the UI.
  'messages',
  'archivedConversations',
  'participatedTogether',

  // Pure cache of text embeddings; anything evicted is re-fetched on demand.
  'embeddingsCache',

  // TownMind shadow-mode comparison logs: short-lived diagnostics only.
  'memoryShadowRuns',
];

export const vacuumOldEntries = internalMutation({
  args: {},
  handler: async (ctx, args) => {
    const before = Date.now() - VACUUM_MAX_AGE;
    for (const tableName of TablesToVacuum) {
      console.log(`Checking ${tableName}...`);
      const exists = await ctx.db
        .query(tableName)
        .withIndex('by_creation_time', (q) => q.lt('_creationTime', before))
        .first();
      if (exists) {
        console.log(`Vacuuming ${tableName}...`);
        await ctx.scheduler.runAfter(0, internal.crons.vacuumTable, {
          tableName,
          before,
          cursor: null,
          soFar: 0,
        });
      }
    }
  },
});

export const vacuumTable = internalMutation({
  args: {
    tableName: v.string(),
    before: v.number(),
    cursor: v.union(v.string(), v.null()),
    soFar: v.number(),
  },
  handler: async (ctx, { tableName, before, cursor, soFar }) => {
    const results = await ctx.db
      .query(tableName as TableNames)
      .withIndex('by_creation_time', (q) => q.lt('_creationTime', before))
      .paginate({ cursor, numItems: DELETE_BATCH_SIZE });
    for (const row of results.page) {
      await ctx.db.delete(row._id);
    }
    if (!results.isDone) {
      await ctx.scheduler.runAfter(0, internal.crons.vacuumTable, {
        tableName,
        before,
        soFar: results.page.length + soFar,
        cursor: results.continueCursor,
      });
    } else {
      console.log(`Vacuumed ${soFar + results.page.length} entries from ${tableName}`);
    }
  },
});

// 90-day retention for raw companion chats: each message / session row is
// deleted once *it* is 90 days old. Sessions are always closed and memorized
// long before that (see the stranded-session sweeper), so this never races
// with an active chat.
export const enforceCompanionRetention = internalMutation({
  args: {},
  handler: async (ctx) => {
    const before = Date.now() - COMPANION_RAW_CHAT_MAX_AGE;
    for (const tableName of ['companionMessages', 'companionSessions'] as TableNames[]) {
      const exists = await ctx.db
        .query(tableName)
        .withIndex('by_creation_time', (q) => q.lt('_creationTime', before))
        .first();
      if (exists) {
        console.log(`Enforcing 90-day retention on ${tableName}...`);
        await ctx.scheduler.runAfter(0, internal.crons.vacuumTable, {
          tableName,
          before,
          cursor: null,
          soFar: 0,
        });
      }
    }
  },
});

// Kick off a per-player quota check for everyone who ever joined a world.
// The player count is small (a few dozen), so collecting descriptions is fine.
export const enforceMemoryQuota = internalMutation({
  args: {},
  handler: async (ctx) => {
    const descriptions = await ctx.db.query('playerDescriptions').collect();
    const playerIds = [...new Set(descriptions.map((d) => d.playerId))];
    for (const pid of playerIds) {
      await ctx.scheduler.runAfter(0, internal.crons.enforcePlayerMemoryQuota, {
        playerId: pid,
      });
      await ctx.scheduler.runAfter(0, internal.crons.enforceTownMindVectorQuota, {
        playerId: pid,
      });
    }
  },
});

// Trim a single player's memories down to the quota, deleting the
// lowest-value ones (importance + recency of last access). The memory row
// and its embedding are always deleted together so the vector index never
// holds orphans.
export const enforcePlayerMemoryQuota = internalMutation({
  args: { playerId },
  handler: async (ctx, args) => {
    const memories = await ctx.db
      .query('memories')
      .withIndex('playerId', (q) => q.eq('playerId', args.playerId))
      .collect();
    const excess = memories.length - MAX_MEMORIES_PER_PLAYER;
    if (excess <= 0) {
      return;
    }
    const now = Date.now();
    const scored = memories.map((memory) => {
      const hoursSinceAccess = (now - memory.lastAccess) / 1000 / 60 / 60;
      // Importance is 0-9; scale recency to the same range so neither
      // dimension dominates.
      const recency = 9 * 0.99 ** Math.floor(hoursSinceAccess);
      return { memory, score: memory.importance + recency };
    });
    scored.sort((a, b) => a.score - b.score);
    const toDelete = scored.slice(0, Math.min(excess, MEMORY_QUOTA_DELETE_CAP));
    for (const { memory } of toDelete) {
      await ctx.db.delete(memory.embeddingId);
      await ctx.db.delete(memory._id);
    }
    console.log(
      `Memory quota: deleted ${toDelete.length}/${excess} excess memories for player ${args.playerId}`,
    );
  },
});

// Same quota for the TownMind (P1 dual-write) vector table, so the shadow
// system can't grow a second unbounded vector index on the 4GB host. Unlike
// the legacy path we don't delete the memory content: the oldest vectors are
// dropped and their episodes demoted from hot to warm (indexed access only),
// per the design's "demote indexes, never age-delete long-term memory".
export const enforceTownMindVectorQuota = internalMutation({
  args: { playerId },
  handler: async (ctx, args) => {
    const vectors = await ctx.db
      .query('townMemoryEmbeddings')
      .withIndex('owner', (q) => q.eq('ownerPlayerId', args.playerId))
      .collect();
    const excess = vectors.length - MAX_MEMORIES_PER_PLAYER;
    if (excess <= 0) {
      return;
    }
    // Index order within one owner is creation time ascending: oldest first.
    const toDemote = vectors.slice(0, Math.min(excess, MEMORY_QUOTA_DELETE_CAP));
    for (const row of toDemote) {
      if (row.memoryType === 'episode') {
        const episode = await ctx.db.get(row.memoryId as Id<'memoryEpisodes'>);
        if (episode && episode.tier === 'hot') {
          await ctx.db.patch(episode._id, { tier: 'warm' });
        }
      }
      await ctx.db.delete(row._id);
    }
    console.log(
      `TownMind vector quota: demoted ${toDemote.length}/${excess} items for player ${args.playerId}`,
    );
  },
});

// Redact TownMind events whose retention window has passed: remove the raw
// text and clear expiresAt (so the row stops matching this query), keeping
// the provenance metadata. Re-schedules itself while there's more work.
export const redactExpiredMemoryEvents = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const expired = await ctx.db
      .query('memoryEvents')
      .withIndex('expiresAt', (q) => q.gt('expiresAt', 0).lte('expiresAt', now))
      .take(DELETE_BATCH_SIZE);
    for (const event of expired) {
      await ctx.db.patch(event._id, {
        normalizedText: undefined,
        expiresAt: undefined,
        status: 'redacted',
      });
    }
    if (expired.length === DELETE_BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.crons.redactExpiredMemoryEvents, {});
    } else if (expired.length > 0) {
      console.log(`Redacted ${expired.length} expired memory events`);
    }
  },
});

// Companion sessions must always end up summarized into the pet's memory.
// Two failure modes are recovered here:
//  1. The client crashed / disconnected without calling endVisit: the session
//     is still open but has had no activity for hours. Close it and memorize.
//  2. endVisit ran but the scheduled rememberVisit action failed (LLM error):
//     the session is ended but not memorized. Retry after a grace period.
export const sweepStrandedCompanionSessions = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    // memorized is undefined until rememberVisit succeeds, so this index scan
    // returns exactly the sessions that may still need work (including
    // currently-active ones, which we skip below).
    const candidates = await ctx.db
      .query('companionSessions')
      .withIndex('memorized', (q) => q.eq('memorized', undefined))
      .take(32);
    for (const session of candidates) {
      if (session.endedAt !== undefined) {
        if (session.endedAt < now - COMPANION_MEMORIZE_GRACE) {
          console.log(`Retrying memorization of ended session ${session._id}`);
          await ctx.scheduler.runAfter(0, internal.companionChat.rememberVisit, {
            sessionId: session._id,
          });
        }
        continue;
      }
      // Open session: consider it abandoned only if there has been no
      // activity (last message, or start if no messages) for a long time.
      const lastMessage = await ctx.db
        .query('companionMessages')
        .withIndex('sessionId', (q) => q.eq('sessionId', session._id))
        .order('desc')
        .first();
      const lastActivity = lastMessage?._creationTime ?? session.startedAt;
      if (lastActivity < now - COMPANION_SESSION_STALE_AGE) {
        console.log(`Closing abandoned companion session ${session._id}`);
        await ctx.db.patch(session._id, { endedAt: lastActivity });
        await ctx.scheduler.runAfter(0, internal.companionChat.rememberVisit, {
          sessionId: session._id,
        });
      }
    }
  },
});
