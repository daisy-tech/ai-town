# Convex 超限问题解决方案

## 🚨 当前问题

```
Your projects are disabled because the team exceeded Free plan limits.
Decrease your usage or upgrade to re-enable your projects.
```

## 📊 免费计划限制

Convex Free Plan 通常包括：
- 数据存储: 1 GB
- 函数调用: 每月有限次数
- 带宽: 有限的数据传输
- 向量索引: 可能有额外限制

## 🛠️ 解决方案

### 方案1: 清理数据 ⭐️ 推荐

#### 步骤1: 检查当前使用情况

访问 Convex Dashboard 查看：
- 数据库大小
- 函数调用统计
- 带宽使用

```bash
# 查看所有表的数据
npx convex data

# 查看项目信息
npx convex dev --once
```

#### 步骤2: 清理策略

**A. 清空所有数据（最彻底）**
```bash
# ⚠️  警告：会删除所有数据！
npx convex run testing:wipeAllTables
```

**B. 只清理记忆数据**

创建清理函数 `convex/cleanup.ts`:

```typescript
import { internalMutation } from './_generated/server';

export const cleanupOldMemories = internalMutation({
  handler: async (ctx) => {
    // 删除所有记忆
    const memories = await ctx.db.query('memories').collect();
    for (const memory of memories) {
      await ctx.db.delete(memory._id);
    }

    // 删除所有向量
    const embeddings = await ctx.db.query('memoryEmbeddings').collect();
    for (const embedding of embeddings) {
      await ctx.db.delete(embedding._id);
    }

    // 清理缓存
    const cache = await ctx.db.query('embeddingsCache').collect();
    for (const item of cache) {
      await ctx.db.delete(item._id);
    }

    return {
      deletedMemories: memories.length,
      deletedEmbeddings: embeddings.length,
      deletedCache: cache.length,
    };
  },
});
```

运行清理：
```bash
npx convex run cleanup:cleanupOldMemories
```

**C. 保留最近N条记忆**

修改上面的函数，添加时间过滤：

```typescript
// 只删除7天前的记忆
const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
const oldMemories = memories.filter(m => m._creationTime < sevenDaysAgo);
```

#### 步骤3: 优化设置

修改 `convex/constants.ts`:

```typescript
// 减少记忆数量
export const NUM_MEMORIES_TO_SEARCH = 3;  // 从默认值减少

// 提高反思阈值（减少反思记忆）
// 在 convex/agent/memory.ts 修改：
const shouldReflect = sumOfImportanceScore > 1000;  // 从500提高到1000
```

---

### 方案2: 升级付费计划

#### Convex 付费计划对比

| 计划 | 价格 | 数据存储 | 函数调用 | 向量搜索 |
|-----|------|---------|---------|---------|
| Free | $0 | 1 GB | 有限 | 有限 |
| Starter | ~$25/月 | 10 GB | 更多 | 更多 |
| Pro | 定制 | 更大 | 无限 | 无限 |

**升级方法**:
1. 访问 https://dashboard.convex.dev
2. 选择项目
3. 点击 "Upgrade" 或 "Billing"
4. 选择付费计划

**适用场景**:
- 正式产品开发
- 需要长期运行
- 数据量较大

---

### 方案3: 迁移到其他方案

#### A. 使用本地向量数据库

替换Convex向量搜索为本地方案：

**选项1: ChromaDB**
```bash
pip install chromadb
```

**选项2: Qdrant**
```bash
docker run -p 6333:6333 qdrant/qdrant
```

**选项3: Weaviate**
```bash
docker-compose up -d
```

#### B. 使用其他Backend服务

**选项1: Supabase** (有PostgreSQL + pgvector)
- 免费计划: 500MB数据库
- 向量搜索支持
- 开源，可自托管

**选项2: Firebase** (无向量搜索)
- 免费计划: 1GB存储
- 需要自行实现向量搜索

**选项3: 自托管PostgreSQL + pgvector**
- 完全免费
- 需要服务器

---

### 方案4: 减少向量使用

#### 优化策略

**1. 减少Embedding调用**

修改 `convex/agent/conversation.ts`:

```typescript
// 只在必要时搜索记忆
const useMemories = conversation.messageCount > 3;  // 前3条消息不搜索
if (useMemories) {
  const memories = await memory.searchMemories(...);
}
```

**2. 简化记忆内容**

修改 `convex/agent/memory.ts`:

```typescript
// 缩短记忆描述，减少向量维度影响
const description = content.substring(0, 200);  // 限制200字符
```

**3. 减少记忆保留时间**

添加自动清理：

```typescript
// convex/crons.ts
export default cronJobs.daily(
  "cleanup old memories",
  { hourUTC: 2, minuteUTC: 0 },
  internal.cleanup.cleanupOldMemories,
);
```

---

## 🎯 推荐方案（按优先级）

### 对于学习/测试项目：

1. **立即清理数据** ✅
   ```bash
   npx convex run testing:wipeAllTables
   ```
   - 重新启动项目
   - 数据会重新生成

2. **优化配置** ✅
   - 减少记忆搜索数量
   - 提高反思阈值
   - 缩短记忆描述

3. **定期清理** ✅
   - 每周清理一次旧数据
   - 只保留最近几天的记忆

### 对于正式项目：

1. **升级付费计划** 💳
   - Starter Plan ($25/月)
   - 足够支持中小规模应用

2. **实施数据管理策略** 📊
   - 自动清理旧数据
   - 归档重要记忆
   - 监控使用量

---

## 📝 检查清单

- [ ] 查看Convex Dashboard的使用统计
- [ ] 确定是否需要保留当前数据
- [ ] 选择清理方案（全部清空 vs 保留部分）
- [ ] 执行清理命令
- [ ] 优化配置减少未来使用量
- [ ] 考虑是否需要升级计划

---

## 🔗 相关链接

- Convex Dashboard: https://dashboard.convex.dev
- Convex 定价: https://www.convex.dev/pricing
- Convex 文档: https://docs.convex.dev

---

## 💬 后续建议

### 开发阶段
- 频繁清理测试数据
- 使用较小的配置值
- 监控使用量

### 生产阶段
- 升级到付费计划
- 实施数据归档策略
- 设置使用量告警

---

## ⚡ 快速恢复步骤

如果你想立即恢复项目运行：

```bash
# 1. 清空所有数据
npx convex run testing:wipeAllTables

# 2. 等待几秒钟

# 3. 重启开发服务器
npm run dev

# 4. 项目会重新初始化并创建角色
```

**注意**: 这会删除所有已生成的记忆和对话数据！
