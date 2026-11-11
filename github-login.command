#!/bin/bash
# 一次性授权 GitHub：双击本文件，按提示在浏览器里输入代码即可。
# 授权完成后回到 WorkBuddy 说一声，剩下建仓库和推送由助手完成。
cd "$(dirname "$0")" || exit 1

GH="$HOME/.local/bin/gh"
if [ ! -x "$GH" ]; then
  echo "找不到 gh（$GH）。请让助手重新安装 GitHub CLI。"
  read -r -p "按回车关闭…"
  exit 1
fi

"$GH" auth login --hostname github.com --git-protocol https --web --skip-ssh-key

echo
if "$GH" auth status >/dev/null 2>&1; then
  echo "授权成功。回到 WorkBuddy 说一声「授权好了」，助手会创建仓库并推送。"
else
  echo "还没有授权成功，可以重新双击本文件再试一次。"
fi
read -r -p "按回车关闭…"
