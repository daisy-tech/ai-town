import { v } from 'convex/values';
import { ActionCtx, DatabaseReader, internalMutation, internalQuery } from '../_generated/server';
import { Doc, Id } from '../_generated/dataModel';
import { internal } from '../_generated/api';
import { LLMMessage, chatCompletion, fetchEmbedding } from '../util/llm';
import { asyncMap } from '../util/asyncMap';
import { GameId, agentId, conversationId, playerId } from '../aiTown/ids';
import { SerializedPlayer } from '../aiTown/player';
import { memoryFields } from './schema';

// How long to wait before updating a memory's last access time.
export const MEMORY_ACCESS_THROTTLE = 300_000; // In ms
// We fetch 10x the number of memories by relevance, to have more candidates
// for sorting by relevance + recency + importance.
const MEMORY_OVERFETCH = 10;
// Reflect after this many new event/relationship memories accumulate.
const MEMORIES_PER_REFLECTION = 10;
const selfInternal = internal.agent.memory;

export type Memory = Doc<'memories'>;
export type MemoryType = Memory['data']['type'];
export type MemoryOfType<T extends MemoryType> = Omit<Memory, 'data'> & {
  data: Extract<Memory['data'], { type: T }>;
};

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
        `- 总结中要提到${otherPlayer.name}的名字。`,
        `- 不超过100个汉字。`,
        `- 只写值得记住的要点，不要逐句复述对话过程，不要写"我们先聊了…然后…"这样的流水账。`,
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

// Extract up to 3 standalone facts the agent learned about the other player
// and store them as "relationship" memories. These short semantic memories
// are cheap to retrieve and inject into future prompts.
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
        `- 只要长期有效的信息，忽略临时状态（如"正在做某事"、"今天要去哪"、"设备刚保养过"这类几天后就过时的内容）。`,
        `- 最多3条，宁缺毋滥；如果没有值得长期记住的事实，返回空数组 []。`,
        `- 每条是一个完整的中文短句，不超过40个汉字，并包含${otherPlayer.name}的名字。`,
        `- 只输出JSON字符串数组，例如：["${otherPlayer.name}喜欢比试光线技能"]，不要输出其他内容。`,
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
  for (const fact of facts.slice(0, 3)) {
    const description = fact.trim();
    const importance = await calculateImportance(description);
    const { embedding } = await fetchEmbedding(description);
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
    const conversation = await ctx.db
      .query('archivedConversations')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('id', args.conversationId))
      .first();
    if (!conversation) {
      throw new Error(`Conversation ${args.conversationId} not found`);
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
      throw new Error(
        `Couldn't find other participant in conversation ${args.conversationId} with player ${args.playerId}`,
      );
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
      throw new Error(`Conversation ${args.conversationId} other player not found`);
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
) {
  const candidates = await ctx.vectorSearch('memoryEmbeddings', 'embedding', {
    vector: searchEmbedding,
    filter: (q) => q.eq('playerId', playerId),
    limit: n * MEMORY_OVERFETCH,
  });
  const rankedMemories = await ctx.runMutation(selfInternal.rankAndTouchMemories, {
    candidates,
    n,
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
  },
  handler: async (ctx, args) => {
    const ts = Date.now();
    const relatedMemories = await asyncMap(args.candidates, async ({ _id }) => {
      const memory = await ctx.db
        .query('memories')
        .withIndex('embeddingId', (q) => q.eq('embeddingId', _id))
        .first();
      if (!memory) throw new Error(`Memory for embedding ${_id} not found`);
      return memory;
    });

    // TODO: fetch <count> recent memories and <count> important memories
    // so we don't miss them in case they were a little less relevant.
    const recencyScore = relatedMemories.map((memory) => {
      const hoursSinceAccess = (ts - memory.lastAccess) / 1000 / 60 / 60;
      return 0.99 ** Math.floor(hoursSinceAccess);
    });
    const relevanceRange = makeRange(args.candidates.map((c) => c._score));
    const importanceRange = makeRange(relatedMemories.map((m) => m.importance));
    const recencyRange = makeRange(recencyScore);
    const memoryScores = relatedMemories.map((memory, idx) => ({
      memory,
      overallScore:
        normalize(args.candidates[idx]._score, relevanceRange) +
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

async function calculateImportance(description: string) {
  const { content: importanceRaw } = await chatCompletion({
    messages: [
      {
        role: 'user',
        content: `请评估下面这条记忆的重要程度，范围0到9。参考锚点：
      - 0-1：完全日常琐事（如刷牙、日常巡逻、设备保养）
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
      embeddingId,
    });
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
        ...rest,
        data: {
          type: 'reflection',
          relatedMemoryIds,
        },
      });
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
  const prompt = ['[不要使用散文]', '[仅输出JSON]', `你是${name}，关于你的陈述：`];
  memories.forEach((m, idx) => {
    prompt.push(`陈述${idx}：${m.description}`);
  });
  prompt.push('你能从以上陈述中推断出哪3条高层次的见解？');
  prompt.push('每条见解是一个完整的中文单句，不超过50个汉字。');
  prompt.push(
    '见解必须落在具体的人、你和某人的关系、或你接下来想做的事上（例如"梦比优斯和赛罗都成长很快，我的指导方式很受欢迎"），不要写抽象的哲理格言。',
  );
  prompt.push(
    '以JSON格式返回，其中键是对你的见解有贡献的输入陈述列表，值是你的见解。使响应可被Typescript的JSON.parse()函数解析。不要转义字符或在响应中包含"\\n"或空格。',
  );
  prompt.push(
    '示例：[{insight: "...", statementIds: [1,2]}, {insight: "...", statementIds: [1]}, ...]',
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
    const memoriesToSave = await asyncMap(insights, async (item) => {
      const relatedMemoryIds = item.statementIds.map((idx: number) => memories[idx]._id);
      const importance = await calculateImportance(item.insight);
      const { embedding } = await fetchEmbedding(item.insight);
      console.debug('添加反思记忆...', item.insight);
      return {
        description: item.insight,
        embedding,
        importance,
        relatedMemoryIds,
      };
    });

    await ctx.runMutation(selfInternal.insertReflectionMemories, {
      worldId,
      playerId,
      reflections: memoriesToSave,
    });
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
    const memories = await ctx.db
      .query('memories')
      .withIndex('playerId', (q) => q.eq('playerId', player.id))
      .order('desc')
      .take(args.numberOfItems);

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
