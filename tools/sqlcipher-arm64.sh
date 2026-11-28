#!/bin/bash
# Apple Silicon 机器优先走 arm64 Python 兼容替身，避免宿主继承 x86_64 架构加载失败；
# 其他机器自动回退到 Homebrew / 系统路径下的 sqlcipher。
set -euo pipefail
if [ "$(uname -m)" = "arm64" ] && [ -f "$HOME/.local/bin/sqlcipher" ]; then
  exec /usr/bin/arch -arm64 /usr/bin/python3 "$HOME/.local/bin/sqlcipher" "$@"
fi
for BIN in /opt/homebrew/bin/sqlcipher /usr/local/bin/sqlcipher "$(command -v sqlcipher 2>/dev/null || true)"; do
  if [ -n "$BIN" ] && [ -x "$BIN" ]; then
    exec "$BIN" "$@"
  fi
done
echo "未找到 sqlcipher，请先安装（brew install sqlcipher）" >&2
exit 1
