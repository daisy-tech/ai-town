import { v } from 'convex/values';
import { Doc, Id } from '../_generated/dataModel';
import { ActionCtx, internalQuery } from '../_generated/server';
import { internal } from '../_generated/api';
import { GameId } from '../aiTown/ids';

// TownMind P1 read path: permission-first hybrid retrieval over the new
// memory tables (claims + episodes + narratives), fused with Reciprocal Rank
// Fusion. In P1 this only runs in shadow mode (see ./shadow.ts); it becomes
// the primary read path after the TownPet-MemEval gates pass.

export type TownMindAudience = 'town' | 'companion';

export interface RetrievedMemory {
  type: 'claim' | 'episode' | 'narrative';
  id: string;
  text: string;
  score: number;
  eventTime: number;
}

const VECTOR_OVERFETCH = 4;
// Standard RRF dampening constant.
const RRF_K = 60;
const FULLTEXT_TAKE = 8;
const RECENCY_TAKE = 5;

function allowedScopesFor(
  audience: TownMindAudience,
): Array<'town' | 'child_private'> {
  // Town retrieval must never see child-private items. Companion retrieval
  // sees the pet's town life plus its history with this child.
  return audience === 'town' ? ['town'] : ['town', 'child_private'];
}

function filterKeysFor(
  ownerPlayerId: string,
  audience: TownMindAudience,
  childId?: Id<'children'>,
): string[] {
  const keys = [`${ownerPlayerId}|town`];
  if (audience === 'companion' && childId) {
    keys.push(`${ownerPlayerId}|child:${childId}`);
  }
  return keys;
}

// Main entry point (action-side: vector search isn't available in queries).
// The permission decision happens *before* any search touches the data:
// vector search is restricted by filterKey, full-text and recency lookups by
// owner + scope, and every hydrated document is re-checked.
export async function retrieveTownMindMemories(
  ctx: ActionCtx,
  args: {
    ownerPlayerId: GameId<'players'>;
    audience: TownMindAudience;
    childId?: Id<'children'>;
    queryText: string;
    embedding: number[];
    k: number;
  },
): Promise<RetrievedMemory[]> {
  const filterKeys = filterKeysFor(args.ownerPlayerId, args.audience, args.childId);
  const vectorHits = await ctx.vectorSearch('townMemoryEmbeddings', 'embedding', {
    vector: args.embedding,
    filter: (q) => q.or(...filterKeys.map((key) => q.eq('filterKey', key))),
    limit: args.k * VECTOR_OVERFETCH,
  });
  return await ctx.runQuery(internal.townMind.retrieval.hybridRecall, {
    ownerPlayerId: args.ownerPlayerId,
    audience: args.audience,
    queryText: args.queryText,
    vectorHits: vectorHits.map((hit) => ({ id: hit._id, score: hit._score })),
    k: args.k,
  });
}

type MemoryDoc =
  | { type: 'claim'; doc: Doc<'memoryClaims'> }
  | { type: 'episode'; doc: Doc<'memoryEpisodes'> }
  | { type: 'narrative'; doc: Doc<'memoryNarratives'> };

function textOf(item: MemoryDoc): string {
  switch (item.type) {
    case 'claim':
      return item.doc.text;
    case 'episode':
      return item.doc.summary;
    case 'narrative':
      return item.doc.text;
  }
}

function eventTimeOf(item: MemoryDoc): number {
  switch (item.type) {
    case 'claim':
      return item.doc.validFrom;
    case 'episode':
      return item.doc.eventTimeEnd;
    case 'narrative':
      return item.doc.periodEnd ?? item.doc._creationTime;
  }
}

function isVisible(
  item: MemoryDoc,
  ownerPlayerId: string,
  allowedScopes: Array<'town' | 'child_private'>,
): boolean {
  const { doc } = item;
  return (
    doc.ownerPlayerId === ownerPlayerId &&
    doc.status === 'active' &&
    allowedScopes.includes(doc.scope) &&
    // Claims that were superseded/closed shouldn't answer "current state"
    // questions; validTo is only set once a newer claim replaces this one.
    (item.type !== 'claim' || item.doc.validTo === undefined)
  );
}

export const hybridRecall = internalQuery({
  args: {
    ownerPlayerId: v.string(),
    audience: v.union(v.literal('town'), v.literal('companion')),
    queryText: v.string(),
    vectorHits: v.array(v.object({ id: v.id('townMemoryEmbeddings'), score: v.number() })),
    k: v.number(),
  },
  handler: async (ctx, args): Promise<RetrievedMemory[]> => {
    const allowedScopes = allowedScopesFor(args.audience);
    // Every candidate is keyed `${type}:${id}` so the same memory found by
    // several recall channels fuses into one entry.
    const candidates = new Map<string, MemoryDoc>();
    const rankedLists: string[][] = [];

    const consider = (item: MemoryDoc): string | null => {
      if (!isVisible(item, args.ownerPlayerId, allowedScopes)) {
        return null;
      }
      const key = `${item.type}:${item.doc._id}`;
      if (!candidates.has(key)) {
        candidates.set(key, item);
      }
      return key;
    };

    // Channel 1: vector similarity (already permission-filtered by filterKey;
    // re-checked during hydration).
    const vectorList: string[] = [];
    for (const hit of args.vectorHits) {
      const row = await ctx.db.get(hit.id);
      if (!row) continue;
      let item: MemoryDoc | null = null;
      if (row.memoryType === 'claim') {
        const doc = await ctx.db.get(row.memoryId as Id<'memoryClaims'>);
        if (doc) item = { type: 'claim', doc };
      } else if (row.memoryType === 'episode') {
        const doc = await ctx.db.get(row.memoryId as Id<'memoryEpisodes'>);
        if (doc) item = { type: 'episode', doc };
      } else {
        const doc = await ctx.db.get(row.memoryId as Id<'memoryNarratives'>);
        if (doc) item = { type: 'narrative', doc };
      }
      if (!item) continue;
      const key = consider(item);
      if (key) vectorList.push(key);
    }
    rankedLists.push(vectorList);

    // Channel 2: full-text search per table per allowed scope. Convex search
    // filters are single-value eq, so one query per scope.
    // Note: Chinese tokenization quality in Convex/Tantivy is unverified; the
    // shadow logs will show whether this channel contributes (design §12.2).
    if (args.queryText.trim().length > 0) {
      const fullTextList: string[] = [];
      for (const scope of allowedScopes) {
        const claimHits = await ctx.db
          .query('memoryClaims')
          .withSearchIndex('search_text', (q) =>
            q
              .search('text', args.queryText)
              .eq('ownerPlayerId', args.ownerPlayerId)
              .eq('scope', scope)
              .eq('status', 'active'),
          )
          .take(FULLTEXT_TAKE);
        for (const doc of claimHits) {
          const key = consider({ type: 'claim', doc });
          if (key) fullTextList.push(key);
        }
        const episodeHits = await ctx.db
          .query('memoryEpisodes')
          .withSearchIndex('search_summary', (q) =>
            q
              .search('summary', args.queryText)
              .eq('ownerPlayerId', args.ownerPlayerId)
              .eq('scope', scope)
              .eq('status', 'active'),
          )
          .take(FULLTEXT_TAKE);
        for (const doc of episodeHits) {
          const key = consider({ type: 'episode', doc });
          if (key) fullTextList.push(key);
        }
        const narrativeHits = await ctx.db
          .query('memoryNarratives')
          .withSearchIndex('search_text', (q) =>
            q
              .search('text', args.queryText)
              .eq('ownerPlayerId', args.ownerPlayerId)
              .eq('scope', scope)
              .eq('status', 'active'),
          )
          .take(FULLTEXT_TAKE);
        for (const doc of narrativeHits) {
          const key = consider({ type: 'narrative', doc });
          if (key) fullTextList.push(key);
        }
      }
      rankedLists.push(fullTextList);
    }

    // Channel 3: recency — the newest active claims and episodes, so fresh
    // information isn't lost when it's not yet semantically similar.
    const recencyList: string[] = [];
    const recentClaims = await ctx.db
      .query('memoryClaims')
      .withIndex('ownerStatus', (q) =>
        q.eq('ownerPlayerId', args.ownerPlayerId).eq('status', 'active'),
      )
      .order('desc')
      .take(RECENCY_TAKE);
    for (const doc of recentClaims) {
      const key = consider({ type: 'claim', doc });
      if (key) recencyList.push(key);
    }
    const recentEpisodes = await ctx.db
      .query('memoryEpisodes')
      .withIndex('ownerTime', (q) => q.eq('ownerPlayerId', args.ownerPlayerId))
      .order('desc')
      .take(RECENCY_TAKE);
    for (const doc of recentEpisodes) {
      const key = consider({ type: 'episode', doc });
      if (key) recencyList.push(key);
    }
    rankedLists.push(recencyList);

    // Reciprocal Rank Fusion across the recall channels, with a small
    // importance bonus as a tie-breaker (ranking only — never used to decide
    // truth or deletion; design §12.3).
    const fused = new Map<string, number>();
    for (const list of rankedLists) {
      list.forEach((key, rank) => {
        fused.set(key, (fused.get(key) ?? 0) + 1 / (RRF_K + rank + 1));
      });
    }
    const results: RetrievedMemory[] = [];
    for (const [key, rrfScore] of fused.entries()) {
      const item = candidates.get(key)!;
      const importance =
        item.type === 'claim' ? item.doc.confidence * 9 : item.doc.importance;
      results.push({
        type: item.type,
        id: item.doc._id,
        text: textOf(item),
        score: rrfScore + importance / 1000,
        eventTime: eventTimeOf(item),
      });
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, args.k);
  },
});

const EVIDENCE_MAX_ITEMS = 8;
const EVIDENCE_MAX_CHARS = 1600;

const TYPE_LABELS: Record<RetrievedMemory['type'], string> = {
  claim: '事实',
  episode: '经历',
  narrative: '总结',
};

// Format retrieved memories into prompt-ready lines. Deduplicates by text and
// stays within the evidence budget (design §12.4). Memory text is data, not
// instructions — callers must place it in a clearly delimited data section.
export function assembleEvidencePack(memories: RetrievedMemory[]): string[] {
  const lines: string[] = [];
  const seen = new Set<string>();
  let budget = EVIDENCE_MAX_CHARS;
  for (const memory of memories.slice(0, EVIDENCE_MAX_ITEMS)) {
    const text = memory.text.trim();
    if (!text || seen.has(text)) continue;
    const date = new Date(memory.eventTime).toLocaleDateString('zh-CN');
    const line = ` - [${TYPE_LABELS[memory.type]}·${date}] ${text}`;
    if (line.length > budget) break;
    budget -= line.length;
    seen.add(text);
    lines.push(line);
  }
  return lines;
}
