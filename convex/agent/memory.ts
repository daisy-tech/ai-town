import { v } from 'convex/values';
import { ActionCtx, DatabaseReader, internalMutation, internalQuery } from '../_generated/server';
import { Doc, Id } from '../_generated/dataModel';
import { internal } from '../_generated/api';
import { LLMMessage, chatCompletion, fetchEmbedding } from '../util/llm';
import { asyncMap } from '../util/asyncMap';
import { GameId, agentId, conversationId, playerId } from '../aiTown/ids';
import { SerializedPlayer } from '../aiTown/player';
import { memoryFields } from './schema';
import { mirrorLegacyMemory } from '../townMind/events';

// Who is asking for memories. Town retrieval (NPC conversations, reflections)
// must never see child-private memories; companion retrieval sees everything
// the pet knows (town life is fine to share with the child, not vice versa).
export type MemoryAudience = 'town' | 'companion';

// Effective scope of a memory, tolerating rows written before the `scope`
// field existed: legacy companion-chat memories are child-private.
export function memoryScopeOf(memory: {
  scope?: 'town' | 'child_private';
  data: { type: string };
}): 'town' | 'child_private' {
  if (memory.scope) {
    return memory.scope;
  }
  return memory.data.type === 'companionChat' ? 'child_private' : 'town';
}

// How long to wait before updating a memory's last access time.
export const MEMORY_ACCESS_THROTTLE = 300_000; // In ms
// We fetch 10x the number of memories by relevance, to have more candidates
// for sorting by relevance + recency + importance.
const MEMORY_OVERFETCH = 10;
// Reflect after this many new event/relationship memories accumulate.
const MEMORIES_PER_REFLECTION = 10;
// Cosine similarity above which a new memory counts as a duplicate of an
// existing one of the same type and is not stored again. Calibrated on the
// 2026-07-22 export: verbatim repeats score ~0.99, paraphrases of the same
// fact ("珍视共同创作的默契" vs "…的仪式感") ~0.9, genuinely different facts
// about the same person < 0.85.
const RELATIONSHIP_DEDUP_THRESHOLD = 0.88;
const REFLECTION_DEDUP_THRESHOLD = 0.9;
// Facts like "X喜欢苹果" are cheap color, never milestones; cap their
// importance so they can't crowd out real events in ranked retrieval.
const RELATIONSHIP_IMPORTANCE_CAP = 4;
const selfInternal = internal.agent.memory;

export type Memory = Doc<'memories'>;
export type MemoryType = Memory['data']['type'];
export type MemoryOfType<T extends MemoryType> = Omit<Memory, 'data'> & {
  data: Extract<Memory['data'], { type: T }>;
};

// Duplicate suppression: the LLM re-derives the same relationship facts and
// reflections over and over (in the 2026-07-22 export, 75% of reflections
// were verbatim repeats and ~half of relationship facts were paraphrases).
// Before inserting, we vector-search the owner's existing memories of the
// same type; a close hit means "already known" — we refresh its lastAccess
// (reinforcement) instead of storing a copy.
async function findDuplicateMemory(
  ctx: ActionCtx,
  playerId: GameId<'players'>,
  embedding: number[],
  memoryType: MemoryType,
  threshold: number,
): Promise<string | null> {
  const candidates = await ctx.vectorSearch('memoryEmbeddings', 'embedding', {
    vector: embedding,
    filter: (q) => q.eq('playerId', playerId),
    limit: 8,
  });
  const close = candidates.filter((c) => c._score >= threshold);
  if (close.length === 0) {
    return null;
  }
  return await ctx.runMutation(selfInternal.touchDuplicateMemory, {
    candidates: close.map(({ _id }) => ({ _id })),
    memoryType,
  });
}

// Returns the description of the first candidate that is a memory of the
// given type (bumping its lastAccess), or null if none of them are.
export const touchDuplicateMemory = internalMutation({
  args: {
    candidates: v.array(v.object({ _id: v.id('memoryEmbeddings') })),
    memoryType: v.string(),
  },
  handler: async (ctx, args): Promise<string | null> => {
    for (const { _id } of args.candidates) {
      const memory = await ctx.db
        .query('memories')
        .withIndex('embeddingId', (q) => q.eq('embeddingId', _id))
        .first();
      if (memory && memory.data.type === args.memoryType) {
        await ctx.db.patch(memory._id, { lastAccess: Date.now() });
        return memory.description;
      }
    }
    return null;
  },
});

export async function rememberConversation(
  ctx: ActionCtx,
  worldId: Id<'worlds'>,
  agentId: GameId<'agents'>,
  playerId: GameId<'players'>,
  conversationId: GameId<'conversations'>,
) {
  const data = await ctx.runQuery(selfInternal.loadConversation, {
    worldId,
    playerId,
    conversationId,
  });
  // The conversation may have been vacuumed before we got to remember it
  // (e.g. after repeated LLM outages). Nothing to summarize; give up cleanly
  // so the agent stops retrying.
  if (data === null) {
    console.warn(`Conversation ${conversationId} data is gone; skipping memory`);
    return;
  }
  const { player, otherPlayer } = data;
  const messages = await ctx.runQuery(selfInternal.loadMessages, { worldId, conversationId });
  if (!messages.length) {
    return;
  }

  const llmMessages: LLMMessage[] = [
    {
      role: 'user',
      content: [
        `你是${player.name}，你刚刚和${otherPlayer.name}结束了一次对话。`,
        `请用中文、以第一人称（"我"）总结这次对话里值得记住的内容：新了解到的信息、达成的约定、对方的状态或情绪、你的感受。`,
        `要求：`,
        `- 总结中要提到${otherPlayer.name}的名字，用"TA"指代对方，不要用"他"或"她"。`,
        `- 不超过100个汉字。`,
        `- 只写值得记住的要点，不要逐句复述对话过程，不要写"我们先聊了…然后…"这样的流水账。`,
        `- 约定类内容最多保留一个（挑最重要的），不要罗列所有约定。`,
      ].join('\n'),
    },
  ];
  const authors = new Set<GameId<'players'>>();
  for (const message of messages) {
    const author = message.author === player.id ? player : otherPlayer;
    authors.add(author.id as GameId<'players'>);
    const recipient = message.author === player.id ? otherPlayer : player;
    llmMessages.push({
      role: 'user',
      content: `${author.name}对${recipient.name}说：${message.text}`,
    });
  }
  llmMessages.push({ role: 'user', content: '总结：' });
  const { content } = await chatCompletion({
    messages: llmMessages,
    max_tokens: 200,
  });
  const description = content.trim();
  const importance = await calculateImportance(description);
  const { embedding } = await fetchEmbedding(description);
  authors.delete(player.id as GameId<'players'>);
  await ctx.runMutation(selfInternal.insertMemory, {
    agentId,
    playerId: player.id,
    description,
    importance,
    lastAccess: messages[messages.length - 1]._creationTime,
    data: {
      type: 'conversation',
      conversationId,
      playerIds: [...authors],
    },
    embedding,
  });
  await rememberRelationshipFacts(ctx, agentId, player, otherPlayer, messages);
  await reflectOnMemories(ctx, worldId, playerId);
  return description;
}

// Extract up to 2 standalone facts the agent learned about the other player
// and store them as "relationship" memories. These short semantic memories
// are cheap to retrieve and inject into future prompts. Facts the agent
// already knows (by embedding similarity) are reinforced, not re-stored.
async function rememberRelationshipFacts(
  ctx: ActionCtx,
  agentId: GameId<'agents'>,
  player: { id: string; name: string },
  otherPlayer: { id: string; name: string },
  messages: Doc<'messages'>[],
) {
  const llmMessages: LLMMessage[] = [
    {
      role: 'user',
      content: [
        `你是${player.name}。下面是你和${otherPlayer.name}的对话记录。`,
        `请从中提取你新了解到的、关于${otherPlayer.name}的、长期有效的事实（例如TA的喜好、性格、习惯、人际关系、长期目标）。`,
        `要求：`,
        `- 只要长期有效的信息，忽略临时状态（如"正在做某事"、"今天要去哪"、"作业刚写完"这类几天后就过时的内容）。`,
        `- 只要对话中明确说出的事实，不要基于比喻或气氛推断（比如对方把叶子比作星星，不代表"TA喜欢星星"）。`,
        `- 最多2条，宁缺毋滥；平淡的寒暄对话通常一条都提不出来，此时返回空数组 []。`,
        `- 每条是一个完整的中文短句，不超过40个汉字，并包含${otherPlayer.name}的名字。`,
        `- 只输出JSON字符串数组，例如：["${otherPlayer.name}喜欢吃苹果"]，不要输出其他内容。`,
      ].join('\n'),
    },
  ];
  for (const message of messages) {
    const author = message.author === player.id ? player : otherPlayer;
    const recipient = message.author === player.id ? otherPlayer : player;
    llmMessages.push({
      role: 'user',
      content: `${author.name}对${recipient.name}说：${message.text}`,
    });
  }
  llmMessages.push({ role: 'user', content: '事实列表（JSON数组）：' });
  const { content } = await chatCompletion({
    messages: llmMessages,
    temperature: 0.0,
    max_tokens: 300,
  });
  let facts: string[];
  try {
    const cleaned = content
      .trim()
      .replace(/^```(json)?/i, '')
      .replace(/```$/, '')
      .trim();
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) {
      throw new Error(`Expected an array, got: ${cleaned}`);
    }
    facts = parsed.filter((f): f is string => typeof f === 'string' && f.trim().length > 0);
  } catch (e) {
    console.debug(`Couldn't parse relationship facts, skipping: ${content}`, e);
    return;
  }
  const lastMessageTime = messages[messages.length - 1]._creationTime;
  for (const fact of facts.slice(0, 2)) {
    const description = fact.trim();
    const { embedding } = await fetchEmbedding(description);
    const duplicateOf = await findDuplicateMemory(
      ctx,
      player.id as GameId<'players'>,
      embedding,
      'relationship',
      RELATIONSHIP_DEDUP_THRESHOLD,
    );
    if (duplicateOf !== null) {
      console.debug(`跳过重复关系记忆 "${description}"（已有 "${duplicateOf}"）`);
      continue;
    }
    const importance = Math.min(
      await calculateImportance(description),
      RELATIONSHIP_IMPORTANCE_CAP,
    );
    console.debug('添加关系记忆...', description);
    await ctx.runMutation(selfInternal.insertMemory, {
      agentId,
      playerId: player.id as GameId<'players'>,
      description,
      importance,
      lastAccess: lastMessageTime,
      data: {
        type: 'relationship',
        playerId: otherPlayer.id as GameId<'players'>,
      },
      embedding,
    });
  }
}

export const loadConversation = internalQuery({
  args: {
    worldId: v.id('worlds'),
    playerId,
    conversationId,
  },
  handler: async (ctx, args) => {
    const world = await ctx.db.get(args.worldId);
    if (!world) {
      throw new Error(`World ${args.worldId} not found`);
    }
    const player = world.players.find((p) => p.id === args.playerId);
    if (!player) {
      throw new Error(`Player ${args.playerId} not found`);
    }
    const playerDescription = await ctx.db
      .query('playerDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('playerId', args.playerId))
      .first();
    if (!playerDescription) {
      throw new Error(`Player description for ${args.playerId} not found`);
    }
    // The conversation bookkeeping below is vacuumed after a few days. If a
    // memory task is retried long enough for that to happen, return null so
    // the caller can give up gracefully instead of retrying forever.
    const conversation = await ctx.db
      .query('archivedConversations')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('id', args.conversationId))
      .first();
    if (!conversation) {
      console.warn(`Conversation ${args.conversationId} not found (vacuumed?)`);
      return null;
    }
    const otherParticipator = await ctx.db
      .query('participatedTogether')
      .withIndex('conversation', (q) =>
        q
          .eq('worldId', args.worldId)
          .eq('player1', args.playerId)
          .eq('conversationId', args.conversationId),
      )
      .first();
    if (!otherParticipator) {
      console.warn(
        `Couldn't find other participant in conversation ${args.conversationId} with player ${args.playerId}`,
      );
      return null;
    }
    const otherPlayerId = otherParticipator.player2;
    let otherPlayer: SerializedPlayer | Doc<'archivedPlayers'> | null =
      world.players.find((p) => p.id === otherPlayerId) ?? null;
    if (!otherPlayer) {
      otherPlayer = await ctx.db
        .query('archivedPlayers')
        .withIndex('worldId', (q) => q.eq('worldId', world._id).eq('id', otherPlayerId))
        .first();
    }
    if (!otherPlayer) {
      console.warn(`Conversation ${args.conversationId} other player not found`);
      return null;
    }
    const otherPlayerDescription = await ctx.db
      .query('playerDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('playerId', otherPlayerId))
      .first();
    if (!otherPlayerDescription) {
      throw new Error(`Player description for ${otherPlayerId} not found`);
    }
    return {
      player: { ...player, name: playerDescription.name },
      conversation,
      otherPlayer: { ...otherPlayer, name: otherPlayerDescription.name },
    };
  },
});

export async function searchMemories(
  ctx: ActionCtx,
  playerId: GameId<'players'>,
  searchEmbedding: number[],
  n: number = 3,
  audience: MemoryAudience = 'town',
) {
  const candidates = await ctx.vectorSearch('memoryEmbeddings', 'embedding', {
    vector: searchEmbedding,
    filter: (q) => q.eq('playerId', playerId),
    limit: n * MEMORY_OVERFETCH,
  });
  const rankedMemories = await ctx.runMutation(selfInternal.rankAndTouchMemories, {
    candidates,
    n,
    audience,
  });
  return rankedMemories.map(({ memory }) => memory);
}

function makeRange(values: number[]) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  return [min, max] as const;
}

function normalize(value: number, range: readonly [number, number]) {
  const [min, max] = range;
  return (value - min) / (max - min);
}

export const rankAndTouchMemories = internalMutation({
  args: {
    candidates: v.array(v.object({ _id: v.id('memoryEmbeddings'), _score: v.number() })),
    n: v.number(),
    audience: v.optional(v.union(v.literal('town'), v.literal('companion'))),
  },
  handler: async (ctx, args) => {
    const ts = Date.now();
    const audience: MemoryAudience = args.audience ?? 'town';
    const loaded = await asyncMap(args.candidates, async ({ _id, _score }) => {
      const memory = await ctx.db
        .query('memories')
        .withIndex('embeddingId', (q) => q.eq('embeddingId', _id))
        .first();
      // Tolerate orphaned embeddings (e.g. from historical vacuum runs that
      // deleted the two tables independently) instead of failing retrieval.
      if (!memory) {
        console.warn(`Memory for embedding ${_id} not found; skipping orphaned vector`);
        return null;
      }
      // Privacy boundary: child-private memories never surface for the town
      // audience (NPC conversations, reflections). Enforced here — after the
      // vector search, before ranking — so every retrieval path is covered.
      if (audience === 'town' && memoryScopeOf(memory) === 'child_private') {
        return null;
      }
      return { memory, score: _score };
    });
    const candidates = loaded.filter((c): c is NonNullable<typeof c> => c !== null);
    if (candidates.length === 0) {
      return [];
    }
    const relatedMemories = candidates.map((c) => c.memory);

    // TODO: fetch <count> recent memories and <count> important memories
    // so we don't miss them in case they were a little less relevant.
    const recencyScore = relatedMemories.map((memory) => {
      const hoursSinceAccess = (ts - memory.lastAccess) / 1000 / 60 / 60;
      return 0.99 ** Math.floor(hoursSinceAccess);
    });
    const relevanceRange = makeRange(candidates.map((c) => c.score));
    const importanceRange = makeRange(relatedMemories.map((m) => m.importance));
    const recencyRange = makeRange(recencyScore);
    const memoryScores = relatedMemories.map((memory, idx) => ({
      memory,
      overallScore:
        normalize(candidates[idx].score, relevanceRange) +
        normalize(memory.importance, importanceRange) +
        normalize(recencyScore[idx], recencyRange),
    }));
    memoryScores.sort((a, b) => b.overallScore - a.overallScore);
    const accessed = memoryScores.slice(0, args.n);
    await asyncMap(accessed, async ({ memory }) => {
      if (memory.lastAccess < ts - MEMORY_ACCESS_THROTTLE) {
        await ctx.db.patch(memory._id, { lastAccess: ts });
      }
    });
    return accessed;
  },
});

export const loadMessages = internalQuery({
  args: {
    worldId: v.id('worlds'),
    conversationId,
  },
  handler: async (ctx, args): Promise<Doc<'messages'>[]> => {
    const messages = await ctx.db
      .query('messages')
      .withIndex('conversationId', (q) =>
        q.eq('worldId', args.worldId).eq('conversationId', args.conversationId),
      )
      .collect();
    return messages;
  },
});

export async function calculateImportance(description: string) {
  const { content: importanceRaw } = await chatCompletion({
    messages: [
      {
        role: 'user',
        content: `请评估下面这条记忆的重要程度，范围0到9。参考锚点：
      - 0-1：完全日常琐事（如刷牙、浇花、日常散步）
      - 2-4：普通社交互动（寒暄、闲聊近况、约好下次一起玩这类日常约定）
      - 5-6：有实质影响的事（学到重要信息、关系明显变化、对方遇到困难）
      - 7-9：重大事件（重要承诺、重大变故、关系破裂或深刻转折）
      注意：普通的友好对话即使聊得开心、有小约定，也只是2-4分；不要因为出现"约定""感动"等词就给高分。
      记忆：${description}
      只回答一个0到9的数字，例如"3"。`,
      },
    ],
    temperature: 0.0,
    max_tokens: 1,
  });

  let importance = parseFloat(importanceRaw);
  if (isNaN(importance)) {
    importance = +(importanceRaw.match(/\d+/)?.[0] ?? NaN);
  }
  if (isNaN(importance)) {
    console.debug('Could not parse memory importance from: ', importanceRaw);
    importance = 5;
  }
  return importance;
}

const { embeddingId: _embeddingId, ...memoryFieldsWithoutEmbeddingId } = memoryFields;

export const insertMemory = internalMutation({
  args: {
    agentId,
    embedding: v.array(v.float64()),
    ...memoryFieldsWithoutEmbeddingId,
  },
  handler: async (ctx, { agentId: _, embedding, ...memory }): Promise<void> => {
    const embeddingId = await ctx.db.insert('memoryEmbeddings', {
      playerId: memory.playerId,
      embedding,
    });
    await ctx.db.insert('memories', {
      ...memory,
      scope: memory.scope ?? 'town',
      embeddingId,
    });
    // TownMind P1 dual-write (shadow system; not user-visible yet).
    try {
      await mirrorLegacyMemory(ctx, {
        ownerPlayerId: memory.playerId as GameId<'players'>,
        description: memory.description,
        importance: memory.importance,
        embedding,
        eventTime: memory.lastAccess,
        scope: memory.scope ?? 'town',
        data: memory.data,
      });
    } catch (e) {
      console.error('TownMind mirror failed for memory insert', e);
    }
  },
});

export const insertReflectionMemories = internalMutation({
  args: {
    worldId: v.id('worlds'),
    playerId,
    reflections: v.array(
      v.object({
        description: v.string(),
        relatedMemoryIds: v.array(v.id('memories')),
        importance: v.number(),
        embedding: v.array(v.float64()),
      }),
    ),
  },
  handler: async (ctx, { playerId, reflections }) => {
    const lastAccess = Date.now();
    for (const { embedding, relatedMemoryIds, ...rest } of reflections) {
      const embeddingId = await ctx.db.insert('memoryEmbeddings', {
        playerId,
        embedding,
      });
      await ctx.db.insert('memories', {
        playerId,
        embeddingId,
        lastAccess,
        scope: 'town',
        ...rest,
        data: {
          type: 'reflection',
          relatedMemoryIds,
        },
      });
      // TownMind P1 dual-write (shadow system; not user-visible yet).
      try {
        await mirrorLegacyMemory(ctx, {
          ownerPlayerId: playerId as GameId<'players'>,
          description: rest.description,
          importance: rest.importance,
          embedding,
          eventTime: lastAccess,
          scope: 'town',
          data: { type: 'reflection', relatedMemoryIds },
        });
      } catch (e) {
        console.error('TownMind mirror failed for reflection insert', e);
      }
    }
  },
});

async function reflectOnMemories(
  ctx: ActionCtx,
  worldId: Id<'worlds'>,
  playerId: GameId<'players'>,
) {
  const { memories, lastReflectionTs, name } = await ctx.runQuery(
    internal.agent.memory.getReflectionMemories,
    {
      worldId,
      playerId,
      numberOfItems: 100,
    },
  );

  // Reflect after accumulating enough new (non-reflection) memories since the
  // last reflection.
  const newMemories = memories.filter(
    (m) => m._creationTime > (lastReflectionTs ?? 0) && m.data.type !== 'reflection',
  );
  const shouldReflect = newMemories.length >= MEMORIES_PER_REFLECTION;

  if (!shouldReflect) {
    return false;
  }
  console.debug(`${newMemories.length} new memories since last reflection`);
  console.debug('反思中...');
  // Only the memories accumulated *since the last reflection* go into the
  // prompt. Feeding the whole recent window (as we did before) made every
  // reflection re-derive the same insights from the same old statements —
  // 75% of stored reflections were verbatim repeats.
  const recentReflections = memories
    .filter((m) => m.data.type === 'reflection')
    .slice(0, 5)
    .map((m) => m.description);
  const prompt = ['[不要使用散文]', '[仅输出JSON]', `你是${name}。你最近的新经历：`];
  newMemories.forEach((m, idx) => {
    prompt.push(`陈述${idx}：${m.description}`);
  });
  if (recentReflections.length > 0) {
    prompt.push(`你之前已有这些见解（不要重复或换句话重说）：`);
    recentReflections.forEach((r) => prompt.push(`- ${r}`));
  }
  prompt.push('你能从这些新经历中归纳出哪些高层次的见解？');
  prompt.push('要求：');
  prompt.push(
    '- 见解必须是跨越多次经历的归纳：你对某人的整体认识、你们关系的变化趋势、或你自己反复出现的行为模式。',
  );
  prompt.push(
    '- 不要复述某一次经历的内容，不要罗列计划或约定（"我打算…""我约定…"这类不算见解）。',
  );
  prompt.push('- 每条是一个完整的中文单句，不超过50个汉字，提到他人时用名字+"TA"，不要用"他/她"。');
  prompt.push('- 最多3条，宁缺毋滥；如果新经历里没有值得归纳的东西，返回空数组 []。');
  prompt.push(
    '以JSON格式返回，其中statementIds是对该见解有贡献的陈述编号列表。使响应可被Typescript的JSON.parse()函数解析。不要转义字符或在响应中包含"\\n"或空格。',
  );
  prompt.push(
    '示例：[{"insight": "...", "statementIds": [1,2]}, {"insight": "...", "statementIds": [1]}]',
  );

  const { content: reflection } = await chatCompletion({
    messages: [
      {
        role: 'user',
        content: prompt.join('\n'),
      },
    ],
  });

  try {
    const insights = JSON.parse(reflection) as { insight: string; statementIds: number[] }[];
    const memoriesToSave = [];
    for (const item of insights) {
      const relatedMemoryIds = item.statementIds
        .filter((idx) => idx >= 0 && idx < newMemories.length)
        .map((idx: number) => newMemories[idx]._id);
      const { embedding } = await fetchEmbedding(item.insight);
      // Backstop against the LLM re-deriving an old insight anyway.
      const duplicateOf = await findDuplicateMemory(
        ctx,
        playerId,
        embedding,
        'reflection',
        REFLECTION_DEDUP_THRESHOLD,
      );
      if (duplicateOf !== null) {
        console.debug(`跳过重复反思 "${item.insight}"（已有 "${duplicateOf}"）`);
        continue;
      }
      const importance = await calculateImportance(item.insight);
      console.debug('添加反思记忆...', item.insight);
      memoriesToSave.push({
        description: item.insight,
        embedding,
        importance,
        relatedMemoryIds,
      });
    }

    if (memoriesToSave.length > 0) {
      await ctx.runMutation(selfInternal.insertReflectionMemories, {
        worldId,
        playerId,
        reflections: memoriesToSave,
      });
    }
  } catch (e) {
    console.error('保存或解析反思时出错', e);
    console.debug('反思', reflection);
    return false;
  }
  return true;
}
export const getReflectionMemories = internalQuery({
  args: { worldId: v.id('worlds'), playerId, numberOfItems: v.number() },
  handler: async (ctx, args) => {
    const world = await ctx.db.get(args.worldId);
    if (!world) {
      throw new Error(`World ${args.worldId} not found`);
    }
    const player = world.players.find((p) => p.id === args.playerId);
    if (!player) {
      throw new Error(`Player ${args.playerId} not found`);
    }
    const playerDescription = await ctx.db
      .query('playerDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('playerId', args.playerId))
      .first();
    if (!playerDescription) {
      throw new Error(`Player description for ${args.playerId} not found`);
    }
    const allMemories = await ctx.db
      .query('memories')
      .withIndex('playerId', (q) => q.eq('playerId', player.id))
      .order('desc')
      .take(args.numberOfItems);
    // Reflections are town-visible, so they must never distill child-private
    // companion chats — exclude those from the reflection inputs entirely.
    const memories = allMemories.filter((m) => memoryScopeOf(m) !== 'child_private');

    const lastReflection = await ctx.db
      .query('memories')
      .withIndex('playerId_type', (q) =>
        q.eq('playerId', args.playerId).eq('data.type', 'reflection'),
      )
      .order('desc')
      .first();

    return {
      name: playerDescription.name,
      memories,
      lastReflectionTs: lastReflection?._creationTime,
    };
  },
});

export async function latestMemoryOfType<T extends MemoryType>(
  db: DatabaseReader,
  playerId: GameId<'players'>,
  type: T,
) {
  const entry = await db
    .query('memories')
    .withIndex('playerId_type', (q) => q.eq('playerId', playerId).eq('data.type', type))
    .order('desc')
    .first();
  if (!entry) return null;
  return entry as MemoryOfType<T>;
}
