# AI Town（daisy-tech）

一个 AI 虚拟小镇：角色在共享地图上移动、社交、对话，支持人类旁观与互动。

本仓库基于 [a16z-infra/ai-town](https://github.com/a16z-infra/ai-town)（MIT License）二次开发。

## 功能概览

- 实时小镇模拟（Convex 游戏引擎 + PixiJS 渲染）
- AI Agent 自主移动、活动、双人对话
- 对话记忆与检索（向量记忆 / 本地关键词记忆）
- 可配置 LLM（通义千问 DashScope、OpenAI、Ollama 等）
- 支持 **Docker 自托管 Convex**（不依赖云端免费额度）
- 可选本地后端模块（`src/localBackend`，用于记忆/LLM 实验）

## 快速开始（推荐：本地 Docker）

### 前置条件

- Node.js 18+
- Docker Desktop
- LLM API Key（例如阿里云 DashScope）

### 1. 安装依赖

```bash
npm install
```

### 2. 配置 LLM

```bash
cp convex/config/llm.env.example .env.llm
# 编辑 .env.llm，填入 LLM_API_KEY
```

注意：`LLM_API_URL` **不要**带末尾 `/v1`（代码会自动拼接 `/v1/chat/completions`）。

### 3. 一键启动自托管后端并初始化

```bash
export LLM_API_KEY='your-key'   # 或写在 .env.llm 里
./scripts/start-local.sh
```

### 4. 启动前后端

```bash
npm run dev:backend   # 终端 1
npm run dev:frontend  # 终端 2
```

打开：**http://localhost:5173/ai-town**

| 服务 | 地址 |
|------|------|
| 游戏 | http://localhost:5173/ai-town |
| Convex 后端 | http://127.0.0.1:3210 |
| Dashboard | http://localhost:6791 |

### 常用运维命令

```bash
npx convex run testing:wipeAllTables   # 清空数据
npx convex run init                    # 重建世界与角色
npx convex run testing:stop            # 停止引擎
npx convex run testing:resume          # 恢复引擎
npx convex run testing:kick            # 踢一下卡住的引擎
```

## Convex 云端模式（可选）

若使用 [Convex Cloud](https://www.convex.dev/)：

```bash
npx convex login
npx convex dev --once --run init
./scripts/setup-llm-env.sh
npm run dev
```

若 team 被暂停（Paused / 超限），请改用上方 Docker 自托管方案。

## 定制内容

| 内容 | 路径 |
|------|------|
| 角色人设 | `data/characters.ts` |
| 地图 | `data/gentle.js`（可用 Tiled + `data/convertMap.js`） |
| 常量阈值 | `convex/constants.ts` |
| LLM 适配 | `convex/util/llm.ts` |

修改角色后请执行 `wipeAllTables` + `init`。

## 项目结构

```
convex/           # 后端：引擎、游戏规则、Agent、记忆
src/              # 前端：React + PixiJS
src/localBackend/ # 本地记忆/LLM 实验模块
data/             # 角色与地图数据
docs/             # 开发文档
scripts/          # 本地启动与 LLM 配置脚本
tools/            # 记忆浏览器、精灵图工具等
```

## 文档

- [本地后端使用指南](docs/本地后端使用指南.md)
- [本地开发方案迁移指南](docs/本地开发方案迁移指南.md)
- [记忆系统技术分析](docs/记忆系统技术分析.md)
- 上游架构说明：[ARCHITECTURE.md](ARCHITECTURE.md)

## License

MIT License。

- 上游版权：Copyright (c) 2023 [a16z-infra](https://github.com/a16z-infra/ai-town)
- 本仓库修改与新增内容：Copyright (c) 2026 daisy-tech

详见 [LICENSE](LICENSE)。

## 致谢

- [a16z-infra/ai-town](https://github.com/a16z-infra/ai-town)
- [Convex](https://convex.dev/)
- [PixiJS](https://pixijs.com/)
