// LLM接口适配器：支持真实API和模拟模式

export interface LLMConfig {
  provider: 'openai' | 'mock';
  apiKey?: string;
  model?: string;
  baseURL?: string;
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMResponse {
  content: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// 配置（从环境变量读取，支持 OpenAI / 通义千问兼容接口）
const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
const baseURL =
  process.env.OPENAI_BASE_URL ||
  (process.env.LLM_API_URL
    ? `${process.env.LLM_API_URL.replace(/\/$/, '')}/v1`
    : 'https://api.openai.com/v1');

const config: LLMConfig = {
  provider: apiKey ? 'openai' : 'mock',
  apiKey,
  model: process.env.LLM_MODEL || 'qwen-plus',
  baseURL,
};

// OpenAI API调用
async function callOpenAI(
  messages: LLMMessage[],
  maxTokens: number = 300,
  temperature: number = 0.7
): Promise<LLMResponse> {
  if (!config.apiKey) {
    throw new Error('OpenAI API Key 未配置');
  }

  try {
    const response = await fetch(`${config.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        max_tokens: maxTokens,
        temperature,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`OpenAI API错误: ${error.error?.message || response.statusText}`);
    }

    const data = await response.json();

    return {
      content: data.choices[0].message.content,
      usage: data.usage,
    };
  } catch (error) {
    console.error('OpenAI API调用失败:', error);
    throw error;
  }
}

// 模拟LLM响应（用于测试）
async function mockLLM(
  messages: LLMMessage[],
  maxTokens: number = 300
): Promise<LLMResponse> {
  // 从消息中提取角色名和对方名
  const systemMsg = messages.find(m => m.role === 'system')?.content || '';
  const userMsg = messages.find(m => m.role === 'user')?.content || '';

  // 简单的模式匹配生成回复
  let response = '';

  if (userMsg.includes('开始') || userMsg.includes('你好')) {
    const responses = [
      '你好！很高兴见到你。',
      '嗨！我们一起努力吧！',
      '你好，有什么我可以帮助的吗？',
    ];
    response = responses[Math.floor(Math.random() * responses.length)];
  } else if (userMsg.includes('地球') || userMsg.includes('守护')) {
    const responses = [
      '守护地球是我们的使命！',
      '我们一起保护这个美丽的星球。',
      '人类和地球都值得我们守护。',
    ];
    response = responses[Math.floor(Math.random() * responses.length)];
  } else if (userMsg.includes('训练') || userMsg.includes('修炼')) {
    const responses = [
      '通过不断训练，我们会变得更强。',
      '修炼是永无止境的。',
      '今天的训练很充实！',
    ];
    response = responses[Math.floor(Math.random() * responses.length)];
  } else if (userMsg.includes('团队') || userMsg.includes('合作')) {
    const responses = [
      '团队合作的力量是无穷的！',
      '只有团结一致才能战胜强敌。',
      '我相信我们的团队！',
    ];
    response = responses[Math.floor(Math.random() * responses.length)];
  } else {
    const responses = [
      '我明白你的意思。',
      '说得对，我们继续加油吧！',
      '这是个好想法。',
      '让我们一起努力！',
      '我也这么认为。',
    ];
    response = responses[Math.floor(Math.random() * responses.length)];
  }

  // 模拟延迟
  await new Promise(resolve => setTimeout(resolve, 300));

  return {
    content: response,
    usage: {
      prompt_tokens: messages.reduce((sum, m) => sum + m.content.length / 4, 0),
      completion_tokens: response.length / 4,
      total_tokens: 0,
    },
  };
}

// 统一的聊天接口
export async function chatCompletion(options: {
  messages: LLMMessage[];
  maxTokens?: number;
  temperature?: number;
}): Promise<LLMResponse> {
  const { messages, maxTokens = 300, temperature = 0.7 } = options;

  console.log(`🤖 [${config.provider}] 调用LLM...`);

  if (config.provider === 'openai') {
    return await callOpenAI(messages, maxTokens, temperature);
  } else {
    return await mockLLM(messages, maxTokens);
  }
}

// 生成对话回复
export async function generateConversationReply(
  playerName: string,
  playerIdentity: string,
  otherPlayerName: string,
  conversationHistory: string[],
  relevantMemories: string[]
): Promise<string> {
  const messages: LLMMessage[] = [
    {
      role: 'system',
      content: `你是${playerName}。${playerIdentity}

相关记忆：
${relevantMemories.join('\n')}

请用中文进行对话，保持角色性格，回复简短（50字以内）。`,
    },
    {
      role: 'user',
      content: `以下是你和${otherPlayerName}的对话：

${conversationHistory.join('\n')}

请继续对话。`,
    },
  ];

  const response = await chatCompletion({ messages, maxTokens: 150 });
  return response.content.trim();
}

// 总结对话
export async function summarizeConversation(
  playerName: string,
  otherPlayerName: string,
  messages: Array<{ author: string; text: string }>
): Promise<string> {
  const conversationText = messages
    .map(m => `${m.author}: ${m.text}`)
    .join('\n');

  const llmMessages: LLMMessage[] = [
    {
      role: 'user',
      content: `你是${playerName}，你刚刚和${otherPlayerName}结束了一次对话。
请用中文从${playerName}的视角总结这次对话，使用第一人称代词如"我"，并说明你是否喜欢或不喜欢这次互动。

对话内容：
${conversationText}

总结：`,
    },
  ];

  const response = await chatCompletion({
    messages: llmMessages,
    maxTokens: 200,
    temperature: 0.5,
  });

  return response.content.trim();
}

// 评估记忆重要性
export async function calculateImportance(description: string): Promise<number> {
  if (config.provider === 'mock') {
    // 模拟模式：基于长度和关键词简单评估
    let importance = 5; // 基础分

    // 长度加分
    if (description.length > 100) importance += 1;
    if (description.length > 200) importance += 1;

    // 关键词加分
    const importantKeywords = ['重要', '危机', '突破', '成长', '领悟', '失败', '成功'];
    importantKeywords.forEach(keyword => {
      if (description.includes(keyword)) importance += 1;
    });

    return Math.min(9, importance);
  }

  // 真实API模式
  const llmMessages: LLMMessage[] = [
    {
      role: 'user',
      content: `On the scale of 0 to 9, where 0 is purely mundane (e.g., brushing teeth, making bed) and 9 is extremely poignant (e.g., a break up, college acceptance), rate the likely poignancy of the following piece of memory.

Memory: ${description}

Answer on a scale of 0 to 9. Respond with number only, e.g. "5"`,
    },
  ];

  try {
    const response = await chatCompletion({
      messages: llmMessages,
      maxTokens: 1,
      temperature: 0,
    });

    let importance = parseFloat(response.content);
    if (isNaN(importance)) {
      importance = +(response.content.match(/\d+/)?.[0] ?? 5);
    }
    if (isNaN(importance)) {
      importance = 5;
    }

    return Math.min(9, Math.max(0, importance));
  } catch (error) {
    console.error('评估重要性失败:', error);
    return 5; // 默认中等重要性
  }
}

// 生成反思见解
export async function generateReflections(
  playerName: string,
  memories: Array<{ description: string; id: string }>
): Promise<Array<{ insight: string; relatedIds: string[] }>> {
  if (config.provider === 'mock') {
    // 模拟模式：生成简单的反思
    return [
      {
        insight: `通过最近的经历，我对团队合作有了更深的理解。`,
        relatedIds: memories.slice(0, 3).map(m => m.id),
      },
      {
        insight: `我意识到持续训练对提升实力至关重要。`,
        relatedIds: memories.slice(1, 4).map(m => m.id),
      },
      {
        insight: `与伙伴的交流让我成长了很多。`,
        relatedIds: memories.slice(2, 5).map(m => m.id),
      },
    ];
  }

  // 真实API模式
  const prompt = [
    '[不要使用散文]',
    '[仅输出JSON]',
    `你是${playerName}，关于你的陈述：`,
  ];

  memories.forEach((m, idx) => {
    prompt.push(`陈述${idx}：${m.description}`);
  });

  prompt.push('你能从以上陈述中推断出哪3条高层次的见解？');
  prompt.push(
    '以JSON格式返回，其中键是对你的见解有贡献的输入陈述列表，值是你的见解。使响应可被Typescript的JSON.parse()函数解析。不要转义字符或在响应中包含"\\n"或空格。'
  );
  prompt.push(
    '示例：[{insight: "...", statementIds: [1,2]}, {insight: "...", statementIds: [1]}, ...]'
  );

  try {
    const response = await chatCompletion({
      messages: [
        {
          role: 'user',
          content: prompt.join('\n'),
        },
      ],
      maxTokens: 500,
      temperature: 0.7,
    });

    const reflections = JSON.parse(response.content) as Array<{
      insight: string;
      statementIds: number[];
    }>;

    return reflections.map(r => ({
      insight: r.insight,
      relatedIds: r.statementIds.map(idx => memories[idx]?.id).filter(Boolean),
    }));
  } catch (error) {
    console.error('生成反思失败:', error);
    return [];
  }
}

// 提取关键词（简单实现）
export function extractKeywords(text: string): string[] {
  // 移除标点符号
  const cleaned = text.replace(/[，。！？、；：""''（）【】《》\s]/g, ' ');

  // 分词（简单按空格分）
  const words = cleaned
    .split(' ')
    .filter(word => word.length >= 2) // 至少2个字符
    .filter(word => word.length <= 10); // 最多10个字符（避免整句）

  // 去重
  const unique = [...new Set(words)];

  // 返回前10个
  return unique.slice(0, 10);
}

// 获取当前配置
export function getLLMConfig(): LLMConfig {
  return { ...config };
}

// 测试LLM连接
export async function testLLMConnection(): Promise<boolean> {
  try {
    const response = await chatCompletion({
      messages: [{ role: 'user', content: '你好' }],
      maxTokens: 10,
    });

    console.log(`✅ LLM连接测试成功 [${config.provider}]`);
    console.log(`   回复: ${response.content}`);
    return true;
  } catch (error) {
    console.error(`❌ LLM连接测试失败 [${config.provider}]:`, error);
    return false;
  }
}
