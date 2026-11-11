#!/bin/bash
# 一次性授权 GitHub：双击本文件，浏览器会自动打开授权页。
# 终端里会显示一次性代码（同时已复制到剪贴板），粘贴到网页里点授权即可。
cd "$(dirname "$0")" || exit 1

GH="$HOME/.local/bin/gh"
if [ ! -x "$GH" ]; then
  echo "找不到 gh（$GH）。请让助手重新安装 GitHub CLI。"
  read -r -p "按回车关闭…"
  exit 1
fi

echo "────────────────────────────────────────"
echo "  1. 浏览器会自动打开 github.com/login/device"
echo "  2. 终端里的一次性代码已复制到剪贴板，直接粘贴"
echo "  3. 点授权，然后回到 WorkBuddy 说一声"
echo "────────────────────────────────────────"
echo

# gh 会先打印一次性代码，再等待授权；放到后台后延迟打开浏览器，避免打开时还没有代码
"$GH" auth login --hostname github.com --git-protocol https --web --skip-ssh-key &
PID=$!
sleep 3
/usr/bin/open "https://github.com/login/device" 2>/dev/null || true
wait "$PID"

echo
if "$GH" auth status >/dev/null 2>&1; then
  echo "✅ 授权成功。回到 WorkBuddy 说一声「授权好了」，剩下建仓库和推送由助手完成。"
else
  echo "还没有授权成功。可以重新双击本文件再试一次。"
fi
read -r -p "按回车关闭…"
