#!/usr/bin/env python3
"""列出某个群在时间窗内的图片消息对应的本地缓存缩略图。
用法: find_images.py <wxid> <since_ts> [limit]
输出: JSON 数组 [{ts, file, size}]
"""
import sys, os, json, hashlib, glob

SKILL = os.path.expanduser("~/.dsh/skills/wechat-decrypt")
sys.path.insert(0, SKILL)
import db  # noqa: E402

def main():
    wxid = sys.argv[1]
    since = int(sys.argv[2])
    limit = int(sys.argv[3]) if len(sys.argv) > 3 else 5
    h = hashlib.md5(wxid.encode()).hexdigest()
    tab = f"Msg_{h}"

    base = db.get_account_files_dir()
    out = []
    for f in glob.glob(os.path.join(base, "cache", "*", "Message", h, "Thumb", "*.jpg")):
        name = os.path.basename(f)
        parts = name.split("_")
        if len(parts) < 3:
            continue
        try:
            ts = int(parts[1])
        except ValueError:
            continue
        if ts <= since:
            continue
        try:
            out.append({"ts": ts, "file": f, "size": os.path.getsize(f)})
        except OSError:
            pass
    out.sort(key=lambda x: -x["ts"])
    out = out[:limit]
    print(json.dumps(out, ensure_ascii=False))

if __name__ == "__main__":
    main()
