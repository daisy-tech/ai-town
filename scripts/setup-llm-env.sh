#!/usr/bin/env bash
# 将 LLM 配置写入 Convex 环境变量
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f .env.llm ]; then
  set -a
  # shellcheck disable=SC1091
  source .env.llm
  set +a
elif [ -f .env.local ]; then
  set -a
  # shellcheck disable=SC1091
  source .env.local
  set +a
fi

API_URL="${LLM_API_URL:-https://dashscope.aliyuncs.com/compatible-mode}"
MODEL="${LLM_MODEL:-qwen-plus}"
EMBEDDING_MODEL="${LLM_EMBEDDING_MODEL:-text-embedding-v3}"

if [ -z "${LLM_API_KEY:-}" ]; then
  echo "请设置 LLM_API_KEY（环境变量、.env.llm 或 .env.local）"
  exit 1
fi

echo "写入 Convex LLM 环境变量..."
npx convex env set LLM_API_URL "$API_URL"
npx convex env set LLM_API_KEY "$LLM_API_KEY"
npx convex env set LLM_MODEL "$MODEL"
npx convex env set LLM_EMBEDDING_MODEL "$EMBEDDING_MODEL"

echo ""
npx convex env list
echo ""
echo "完成。可执行: npx convex run init && npm run dev"
