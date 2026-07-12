import { v } from 'convex/values';
import { internalAction, internalQuery } from './_generated/server';
import { internal } from './_generated/api';
import { LLMMessage, chatCompletion, fetchEmbedding } from './util/llm';
import { GameId } from './aiTown/ids';
import { searchMemories, calculateImportance } from './agent/memory';
import * as embeddingsCache from './agent/embeddingsCache';
import { NUM_MEMORIES_TO_SEARCH } from './constants';

const selfInternal = internal.companionChat;

// 一次陪伴会话里注入 prompt 的最近消息条数。
const MAX_PROMPT_MESSAGES = 10;

const COMPANION_STYLE_RULES = [
  `说话要自然、口语化，像真人聊天，不要写成小说或剧本。`,
  `禁止使用*星号动作描写*、括号旁白或表情符号堆砌。`,
  `每次只说一两句，控制在80个汉字以内。`,
  `对方是6~15岁的孩子：认真倾听、先理解感受再回应，不说教。`,
  `如果孩子提到可能受到伤害或处于危险，温和地鼓励TA告诉可信任的大人。`,
];

// 加载生成回复所需的全部上下文。
export const loadSessionContext = internalQuery({
  args: {
    sessionId: v.id('companionSessions'),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) {
      throw new Error(`Session ${args.sessionId} not found`);
    }
    const adoption = await ctx.db.get(session.adoptionId);
    if (!adoption || !adoption.agentId || !adoption.playerId) {
      throw new Error(`Adoption for session ${args.sessionId} not active`);
    }
    const child = await ctx.db.get(adoption.childId);
    if (!child) {
      throw new Error(`Child ${adoption.childId} not found`);
    }
    const world = await ctx.db.get(adoption.worldId);
    const agent = world?.agents.find((a) => a.id === adoption.agentId);
    let identity = '';
    let plan = '';
    if (agent) {
      const agentDescription = await ctx.db
        .query('agentDescriptions')
        .withIndex('worldId', (q) => q.eq('worldId', adoption.worldId).eq('agentId', agent.id))
        .first();
      identity = agentDescription?.identity ?? '';
      plan = agentDescription?.plan ?? '';
    }
    const messages = await ctx.db
      .query('companionMessages')
      .withIndex('sessionId', (q) => q.eq('sessionId', args.sessionId))
      .collect();
    return {
      session,
      adoption: {
        id: adoption._id,
        petName: adoption.petName,
        species: adoption.species,
        playerId: adoption.playerId,
        childId: adoption.childId,
      },
      childName: child.name,
      identity,
      plan,
      messages: messages.map((m) => ({ author: m.author, text: m.text })),
    };
  },
});

// 生成宠物对孩子最新消息的回复。
export const generateReply = internalAction({
  args: {
    sessionId: v.id('companionSessions'),
  },
  handler: async (ctx, args) => {
    const context = await ctx.runQuery(selfInternal.loadSessionContext, {
      sessionId: args.sessionId,
    });
    const { adoption, childName, identity, plan, messages } = context;
    const petName = adoption.petName;

    // 从共享记忆（小镇经历 + 过往陪伴聊天）中检索相关内容。
    const lastChildMessage = [...messages].reverse().find((m) => m.author === 'child');
    let memoryPrompt: string[] = [];
    try {
      const embedding = await embeddingsCache.fetch(
        ctx,
        `${childName}对我说：${lastChildMessage?.text ?? ''}。我和${childName}之间的事，以及我最近在小镇的经历`,
      );
      const memories = await searchMemories(
        ctx,
        adoption.playerId as GameId<'players'>,
        embedding,
        Number(process.env.NUM_MEMORIES_TO_SEARCH) || NUM_MEMORIES_TO_SEARCH,
      );
      if (memories.length > 0) {
        memoryPrompt = [
          `以下是你的一些相关记忆（包括小镇里的经历和以前与${childName}的聊天）：`,
          ...memories.map((m) => ` - ${m.description}`),
        ];
      }
    } catch (e) {
      console.error('检索陪伴聊天记忆失败，继续无记忆回复', e);
    }

    const systemPrompt = [
      `你是${petName}，现在你"回家"了，正在陪伴你的小主人${childName}聊天。`,
      identity ? `你的身份（仅作背景，不要整段背诵）：${identity}` : '',
      plan ? `你最近在小镇里在意的事：${plan}` : '',
      ...memoryPrompt,
      `请用中文回复${childName}刚才的话。可以自然地分享你在小镇里的见闻，也要关心TA的生活。`,
      ...COMPANION_STYLE_RULES,
    ].filter((line) => line.length > 0);

    const llmMessages: LLMMessage[] = [
      { role: 'system', content: systemPrompt.join('\n') },
      ...messages.slice(-MAX_PROMPT_MESSAGES).map(
        (m): LLMMessage => ({
          role: m.author === 'child' ? ('user' as const) : ('assistant' as const),
          content: m.text,
        }),
      ),
    ];
    const { content } = await chatCompletion({
      messages: llmMessages,
      max_tokens: 160,
    });
    const text = content.trim();
    if (!text) {
      return;
    }
    await ctx.runMutation(internal.companionChatDb.writePetMessage, {
      sessionId: args.sessionId,
      adoptionId: adoption.id,
      text,
    });
  },
});

// 会话结束后，把这次陪伴聊天总结成宠物的一条共享记忆。
export const rememberVisit = internalAction({
  args: {
    sessionId: v.id('companionSessions'),
  },
  handler: async (ctx, args) => {
    const context = await ctx.runQuery(selfInternal.loadSessionContext, {
      sessionId: args.sessionId,
    });
    const { adoption, childName, messages } = context;
    if (messages.length === 0) {
      await ctx.runMutation(internal.companionChatDb.markSessionMemorized, {
        sessionId: args.sessionId,
      });
      return;
    }
    const petName = adoption.petName;
    const llmMessages: LLMMessage[] = [
      {
        role: 'user',
        content: [
          `你是${petName}，你刚刚结束了和小主人${childName}的一次聊天（TA在现实世界，通过屏幕和你说话）。`,
          `请用中文、以第一人称（"我"）总结这次聊天里值得记住的内容：${childName}的近况、心情、说过的重要的事、你们的约定。`,
          `要求：`,
          `- 总结中要提到${childName}的名字。`,
          `- 不超过100个汉字。`,
          `- 只写值得记住的要点，不要流水账。`,
        ].join('\n'),
      },
      ...messages.map(
        (m): LLMMessage => ({
          role: 'user',
          content:
            m.author === 'child'
              ? `${childName}对${petName}说：${m.text}`
              : `${petName}对${childName}说：${m.text}`,
        }),
      ),
      { role: 'user', content: '总结：' },
    ];
    const { content } = await chatCompletion({
      messages: llmMessages,
      max_tokens: 200,
    });
    const description = content.trim();
    if (description) {
      const importance = await calculateImportance(description);
      const { embedding } = await fetchEmbedding(description);
      await ctx.runMutation(internal.companionChatDb.insertVisitMemory, {
        playerId: adoption.playerId,
        childId: adoption.childId,
        description,
        importance,
        embedding,
      });
    }
    await ctx.runMutation(internal.companionChatDb.markSessionMemorized, {
      sessionId: args.sessionId,
    });
  },
});
