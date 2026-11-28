#!/bin/bash
# 双击启动「轻松日程」：优先打开原生独立 App（不留黑窗口），否则后台静默启动本地服务
cd "$(dirname "$0")" || exit 1
ROOT="$(pwd)"

# 1. 优先启动 macOS 独立 App（无需留着终端窗口）
for APP in "$ROOT/轻松日程.app" "/Applications/轻松日程.app" "$ROOT/dist/轻松日程.app"; do
  if [ -d "$APP" ]; then
    /usr/bin/open "$APP"
    exit 0
  fi
done

# 2. 找不到 .app 时后台静默启动 server.mjs（不再把终端挂死）
NODE="$(command -v node 2>/dev/null)"
if [ -z "$NODE" ] && [ -x "$HOME/.local/bin/node" ]; then
  NODE="$HOME/.local/bin/node"
fi
if [ -z "$NODE" ] && [ -x "$HOME/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node" ]; then
  NODE="$HOME/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node"
fi
if [ -z "$NODE" ]; then
  echo "找不到 node，无法启动。"
  read -r -p "按回车关闭…"
  exit 1
fi

if ! /usr/sbin/lsof -nP -iTCP:7788 -sTCP:LISTEN >/dev/null 2>&1; then
  NO_OPEN=1 nohup "$NODE" server.mjs >/tmp/qingsong-rili.log 2>&1 </dev/null &
  disown
  sleep 1
fi

/usr/bin/open "http://127.0.0.1:7788"
exit 0
