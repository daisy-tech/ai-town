import { v } from 'convex/values';
import { ActionCtx, internalAction, internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { GameId, playerId } from '../aiTown/ids';
import { Id } from '../_generated/dataModel';
import * as embeddingsCache from '../agent/embeddingsCache';
import { retrieveTownMindMemories } from './retrieval';

// TownMind P1 shadow mode: for every legacy memory retrieval, run the new
// hybrid retrieval out-of-band and log both result sets for comparison.
// Enabled with `npx convex env set TOWNMIND_SHADOW 1`. The shadow run is
// scheduled asynchronously, so it never adds latency or failures to the
// user-facing answer path.

function shadowEnabled(): boolean {
  return process.env.TOWNMIND_SHADOW === '1';
}

export async function scheduleShadowRun(
  ctx: ActionCtx,
  args: {
    ownerPlayerId: GameId<'players'>;
    audience: 'town' | 'companion';
    childId?: Id<'children'>;
    queryText: string;
    legacyDescriptions: string[];
  },
): Promise<void> {
  if (!shadowEnabled()) {
    return;
  }
  try {
    await ctx.scheduler.runAfter(0, internal.townMind.shadow.runShadowComparison, args);
  } catch (e) {
    console.error('Failed to schedule TownMind shadow run', e);
  }
}

export const runShadowComparison = internalAction({
  args: {
    ownerPlayerId: playerId,
    audience: v.union(v.literal('town'), v.literal('companion')),
    childId: v.optional(v.id('children')),
    queryText: v.string(),
    legacyDescriptions: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const started = Date.now();
    let results: Awaited<ReturnType<typeof retrieveTownMindMemories>> = [];
    let error: string | undefined;
    try {
      // Hits the embeddings cache: the legacy path just embedded this text.
      const embedding = await embeddingsCache.fetch(ctx, args.queryText);
      results = await retrieveTownMindMemories(ctx, {
        ownerPlayerId: args.ownerPlayerId as GameId<'players'>,
        audience: args.audience,
        childId: args.childId,
        queryText: args.queryText,
        embedding,
        k: Math.max(args.legacyDescriptions.length, 3),
      });
    } catch (e: any) {
      error = e?.message ?? String(e);
    }
    const newTexts = new Set(results.map((r) => r.text));
    const overlapCount = args.legacyDescriptions.filter((d) => newTexts.has(d)).length;
    await ctx.runMutation(internal.townMind.shadow.logShadowRun, {
      ownerPlayerId: args.ownerPlayerId,
      audience: args.audience,
      childId: args.childId,
      queryText: args.queryText,
      legacyResults: args.legacyDescriptions,
      townMindResults: results.map((r) => ({ type: r.type, text: r.text, score: r.score })),
      overlapCount,
      latencyMs: Date.now() - started,
      error,
    });
  },
});

export const logShadowRun = internalMutation({
  args: {
    ownerPlayerId: playerId,
    audience: v.union(v.literal('town'), v.literal('companion')),
    childId: v.optional(v.id('children')),
    queryText: v.optional(v.string()),
    legacyResults: v.array(v.string()),
    townMindResults: v.array(
      v.object({ type: v.string(), text: v.string(), score: v.number() }),
    ),
    overlapCount: v.number(),
    latencyMs: v.number(),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert('memoryShadowRuns', args);
  },
});
