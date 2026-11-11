#!/bin/bash
# 双击启动「轻松日程」
cd "$(dirname "$0")" || exit 1

# 优先用 PATH 里的 node；找不到再回退到本机 dsh 运行时
NODE="$(command -v node 2>/dev/null)"
if [ -z "$NODE" ] && [ -x "$HOME/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node" ]; then
  NODE="$HOME/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node"
fi
if [ -z "$NODE" ]; then
  echo "找不到 node，无法启动。"
  read -r -p "按回车关闭…"
  exit 1
fi

# 已经在运行：直接打开页面
if /usr/sbin/lsof -nP -iTCP:7788 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "轻松日程已经在运行 → http://127.0.0.1:7788"
  /usr/bin/open "http://127.0.0.1:7788"
  sleep 1
  exit 0
fi

printf '\033]0;轻松日程\007'
echo "──────────────────────────────"
echo "  轻松日程 · 正在启动"
echo "  ⚠️  这个窗口别关，关了服务就停"
echo "──────────────────────────────"
NO_OPEN=${NO_OPEN:-0} "$NODE" server.mjs
