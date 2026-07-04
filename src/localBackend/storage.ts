import fs from 'fs';
import path from 'path';

export interface Memory {
  id: string;
  playerId: string;
  playerName: string;
  description: string;
  importance: number;
  type: 'conversation' | 'reflection' | 'relationship';
  createdAt: number;
  lastAccess: number;
  metadata?: {
    conversationId?: string;
    otherPlayerId?: string;
    otherPlayerName?: string;
    playerIds?: string[];
    relatedMemoryIds?: string[];
    messageCount?: number;
  };
}

export interface Player {
  id: string;
  name: string;
  description: string;
  character: string;
}

export class LocalStorage {
  private dataDir: string;
  private memoriesFile: string;
  private playersFile: string;
  private memories: Memory[] = [];
  private players: Player[] = [];

  constructor(dataDir: string = './data') {
    this.dataDir = dataDir;
    this.memoriesFile = path.join(this.dataDir, 'memories.json');
    this.playersFile = path.join(this.dataDir, 'players.json');
    this.ensureDataDir();
    this.loadData();
  }

  private ensureDataDir() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  private loadData() {
    // 加载记忆
    try {
      if (fs.existsSync(this.memoriesFile)) {
        const data = fs.readFileSync(this.memoriesFile, 'utf-8');
        this.memories = JSON.parse(data);
        console.log(`📚 加载了 ${this.memories.length} 条记忆`);
      }
    } catch (error) {
      console.error('加载记忆失败:', error);
      this.memories = [];
    }

    // 加载角色
    try {
      if (fs.existsSync(this.playersFile)) {
        const data = fs.readFileSync(this.playersFile, 'utf-8');
        this.players = JSON.parse(data);
        console.log(`👥 加载了 ${this.players.length} 个角色`);
      }
    } catch (error) {
      console.error('加载角色失败:', error);
      this.players = [];
    }
  }

  private saveMemories() {
    try {
      fs.writeFileSync(
        this.memoriesFile,
        JSON.stringify(this.memories, null, 2),
        'utf-8'
      );
    } catch (error) {
      console.error('保存记忆失败:', error);
    }
  }

  private savePlayers() {
    try {
      fs.writeFileSync(
        this.playersFile,
        JSON.stringify(this.players, null, 2),
        'utf-8'
      );
    } catch (error) {
      console.error('保存角色失败:', error);
    }
  }

  // ==================== 角色管理 ====================

  addPlayer(player: Player): Player {
    const existing = this.players.find(p => p.id === player.id);
    if (existing) {
      return existing;
    }

    this.players.push(player);
    this.savePlayers();
    console.log(`✅ 添加角色: ${player.name}`);
    return player;
  }

  getPlayer(playerId: string): Player | undefined {
    return this.players.find(p => p.id === playerId);
  }

  getAllPlayers(): Player[] {
    return [...this.players];
  }

  // ==================== 记忆管理 ====================

  addMemory(memory: Omit<Memory, 'id' | 'createdAt' | 'lastAccess'>): Memory {
    const newMemory: Memory = {
      ...memory,
      id: `mem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      createdAt: Date.now(),
      lastAccess: Date.now(),
    };

    this.memories.push(newMemory);
    this.saveMemories();

    console.log(`💾 [${memory.playerName}] 保存${memory.type}记忆 (重要性: ${memory.importance})`);
    return newMemory;
  }

  getMemory(memoryId: string): Memory | undefined {
    return this.memories.find(m => m.id === memoryId);
  }

  getAllMemories(playerId?: string, type?: Memory['type']): Memory[] {
    let results = [...this.memories];

    if (playerId) {
      results = results.filter(m => m.playerId === playerId);
    }

    if (type) {
      results = results.filter(m => m.type === type);
    }

    return results;
  }

  // 简单的关键词搜索记忆（替代向量搜索）
  searchMemories(
    playerId: string,
    keywords: string[],
    limit: number = 5
  ): Memory[] {
    const now = Date.now();

    // 过滤该角色的记忆
    let results = this.memories.filter(m => m.playerId === playerId);

    if (results.length === 0) {
      return [];
    }

    // 计算每条记忆的评分
    const scored = results.map(memory => {
      let relevanceScore = 0;
      const lowerDesc = memory.description.toLowerCase();

      // 关键词匹配
      keywords.forEach(keyword => {
        if (lowerDesc.includes(keyword.toLowerCase())) {
          relevanceScore += 10;
        }
      });

      // 时效性衰减 (0.99 ^ 小时数)
      const hoursSinceAccess = (now - memory.lastAccess) / (1000 * 60 * 60);
      const recencyScore = Math.pow(0.99, Math.floor(hoursSinceAccess));

      // 综合评分 = 相关性 + 重要性 + 时效性
      const totalScore = relevanceScore + memory.importance + recencyScore * 5;

      return { memory, score: totalScore };
    });

    // 按评分排序
    scored.sort((a, b) => b.score - a.score);

    // 取前N条
    const selected = scored.slice(0, limit).map(s => s.memory);

    // 更新访问时间
    selected.forEach(m => {
      m.lastAccess = now;
    });

    if (selected.length > 0) {
      this.saveMemories();
    }

    return selected;
  }

  // 触发反思：当累计重要性超过阈值时
  shouldReflect(playerId: string, threshold: number = 500): boolean {
    const playerMemories = this.memories.filter(m => m.playerId === playerId);

    // 找到最后一次反思的时间
    const lastReflection = playerMemories
      .filter(m => m.type === 'reflection')
      .sort((a, b) => b.createdAt - a.createdAt)[0];

    const lastReflectionTime = lastReflection?.createdAt || 0;

    // 计算自上次反思以来的重要性总和
    const sumImportance = playerMemories
      .filter(m => m.createdAt > lastReflectionTime)
      .reduce((sum, m) => sum + m.importance, 0);

    return sumImportance > threshold;
  }

  // 添加反思记忆
  addReflection(
    playerId: string,
    playerName: string,
    insight: string,
    relatedMemoryIds: string[]
  ): Memory {
    return this.addMemory({
      playerId,
      playerName,
      description: insight,
      importance: 8, // 反思通常比较重要
      type: 'reflection',
      metadata: {
        relatedMemoryIds,
      },
    });
  }

  // ==================== 统计信息 ====================

  getStats() {
    const total = this.memories.length;
    const byType = {
      conversation: this.memories.filter(m => m.type === 'conversation').length,
      reflection: this.memories.filter(m => m.type === 'reflection').length,
      relationship: this.memories.filter(m => m.type === 'relationship').length,
    };

    const playerStats = this.players.map(player => {
      const playerMemories = this.memories.filter(m => m.playerId === player.id);
      const avgImportance = playerMemories.length > 0
        ? (playerMemories.reduce((sum, m) => sum + m.importance, 0) / playerMemories.length).toFixed(2)
        : '0';

      return {
        playerId: player.id,
        playerName: player.name,
        totalMemories: playerMemories.length,
        conversations: playerMemories.filter(m => m.type === 'conversation').length,
        reflections: playerMemories.filter(m => m.type === 'reflection').length,
        avgImportance,
      };
    });

    // 最近的记忆
    const recentMemories = [...this.memories]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 5)
      .map(m => ({
        playerName: m.playerName,
        type: m.type,
        description: m.description.substring(0, 100) + (m.description.length > 100 ? '...' : ''),
        createdAt: new Date(m.createdAt).toLocaleString('zh-CN'),
      }));

    const avgImportance = total > 0
      ? (this.memories.reduce((sum, m) => sum + m.importance, 0) / total).toFixed(2)
      : '0';

    return {
      total,
      typeStats: byType,
      playerStats,
      avgImportance,
      recentMemories,
    };
  }

  // ==================== 数据管理 ====================

  clearAll() {
    this.memories = [];
    this.players = [];
    this.saveMemories();
    this.savePlayers();
    console.log('🗑️  已清空所有本地数据');
  }

  clearMemories() {
    this.memories = [];
    this.saveMemories();
    console.log('🗑️  已清空所有记忆');
  }

  exportData(): { memories: Memory[]; players: Player[] } {
    return {
      memories: [...this.memories],
      players: [...this.players],
    };
  }

  importData(data: { memories?: Memory[]; players?: Player[] }) {
    if (data.memories) {
      this.memories = data.memories;
      this.saveMemories();
    }
    if (data.players) {
      this.players = data.players;
      this.savePlayers();
    }
    console.log('📥 数据导入完成');
  }
}

// 单例实例
export const localStorage = new LocalStorage();
