#!/usr/bin/env bash
# 使用 Docker 自托管 Convex（不依赖 Convex 云端账号）
set -euo pipefail
cd "$(dirname "$0")/.."

# 从环境变量或 .env.llm 读取 LLM 配置（切勿把真实 Key 写进仓库）
if [ -f .env.llm ]; then
  set -a
  # shellcheck disable=SC1091
  source .env.llm
  set +a
fi

API_URL="${LLM_API_URL:-https://dashscope.aliyuncs.com/compatible-mode}"
MODEL="${LLM_MODEL:-qwen-plus}"
EMBEDDING_MODEL="${LLM_EMBEDDING_MODEL:-text-embedding-v3}"

if [ -z "${LLM_API_KEY:-}" ]; then
  echo "请先设置 LLM_API_KEY，例如："
  echo "  export LLM_API_KEY='your-key'"
  echo "或复制 convex/config/llm.env.example 为 .env.llm 后填写。"
  exit 1
fi

echo "==> 启动 Docker 后端..."
docker compose up -d backend dashboard

echo "==> 等待后端就绪..."
for i in $(seq 1 60); do
  if curl -sf http://127.0.0.1:3210/version >/dev/null 2>&1; then
    echo "后端已就绪"
    break
  fi
  sleep 2
  if [ "$i" -eq 60 ]; then
    echo "后端启动超时，请检查: docker compose logs backend"
    exit 1
  fi
done

echo "==> 生成 admin key..."
ADMIN_KEY=$(docker compose exec -T backend ./generate_admin_key.sh | tr -d '\r' | grep -v '^$' | grep -v 'Admin key' | tail -n 1)
if [ -z "$ADMIN_KEY" ]; then
  echo "生成 admin key 失败"
  exit 1
fi

cat > .env.local <<EOF
# 自托管 Convex
CONVEX_SELF_HOSTED_URL="http://127.0.0.1:3210"
CONVEX_SELF_HOSTED_ADMIN_KEY="${ADMIN_KEY}"
VITE_CONVEX_URL=http://127.0.0.1:3210

BACKEND_TYPE=local
LOCAL_DATA_DIR=./data

LLM_API_URL=${API_URL}
LLM_API_KEY=${LLM_API_KEY}
LLM_MODEL=${MODEL}
LLM_EMBEDDING_MODEL=${EMBEDDING_MODEL}
EOF

echo "==> 部署 Convex 函数并初始化世界..."
export CONVEX_SELF_HOSTED_URL="http://127.0.0.1:3210"
export CONVEX_SELF_HOSTED_ADMIN_KEY="${ADMIN_KEY}"
npx convex dev --once --run init --typecheck=disable

echo "==> 写入 LLM 环境变量..."
npx convex env set LLM_API_URL "$API_URL"
npx convex env set LLM_API_KEY "$LLM_API_KEY"
npx convex env set LLM_MODEL "$MODEL"
npx convex env set LLM_EMBEDDING_MODEL "$EMBEDDING_MODEL"

echo ""
echo "配置完成。启动："
echo "  npm run dev:backend"
echo "  npm run dev:frontend"
echo ""
echo "打开 http://localhost:5173/ai-town"
