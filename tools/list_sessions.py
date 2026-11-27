#!/usr/bin/env python3
"""合并读取 session.db、contact.db、message_fts.db 与 Name2Id，列出真实微信会话（按最近活跃倒序）。"""
import json
import os
import sys

SKIP_USERNAMES = {
    "brandsessionholder",
    "weixin",
    "newsapp",
    "fmessage",
    "medianote",
    "floatbottle",
    "qmessage",
    "qqmail",
    "tmessage",
    "weibo",
    "notifymessage",
    "chatroom_session_box",
    "opencustomerservicemsg",
    "appbrandcustomerservicemsg",
    "filehelper",
}


def is_ignored(wxid: str) -> bool:
    if not wxid:
        return True
    if wxid in SKIP_USERNAMES:
        return True
    if wxid.startswith("@placeholder") or wxid.startswith("gh_"):
        return True
    return False


def main() -> None:
    if len(sys.argv) < 2 or not sys.argv[1]:
        raise SystemExit("用法: list_sessions.py <wechat-decrypt-skill-dir>")
    skill_dir = os.path.abspath(sys.argv[1])
    sys.path.insert(0, skill_dir)

    import contacts  # noqa: E402
    import db  # noqa: E402

    data_dir = db.find_data_dir()

    contact_map: dict[str, dict] = {}
    try:
        contact_map = contacts._build_merged()
    except Exception:
        contact_map = {}

    timestamps: dict[str, int] = {}
    wxids: set[str] = set()

    # 来源 A（主源）：session/session.db — 新进群和最新聊过的会话都在这里
    session_db = os.path.join(data_dir, "session", "session.db")
    if os.path.exists(session_db):
        try:
            rows = db.query(
                session_db,
                "SELECT username, sort_timestamp, last_timestamp FROM SessionTable;",
            )
            for row in rows:
                wxid = (row.get("username") or "").strip()
                if is_ignored(wxid):
                    continue
                wxids.add(wxid)
                try:
                    t1 = int(row.get("last_timestamp") or 0)
                except (TypeError, ValueError):
                    t1 = 0
                try:
                    t2 = int(row.get("sort_timestamp") or 0)
                except (TypeError, ValueError):
                    t2 = 0
                ts = max(t1, t2)
                if ts > timestamps.get(wxid, 0):
                    timestamps[wxid] = ts
        except Exception:
            pass

    # 来源 B：contact/contact.db — 确保刚进但暂未发言的群聊也能被发现
    for wxid in contact_map:
        if wxid.endswith("@chatroom") and not is_ignored(wxid):
            wxids.add(wxid)

    # 来源 C：message/message_fts.db — 覆盖滚动新建分库（如 message_2.db）里的群
    fts_db = os.path.join(data_dir, "message", "message_fts.db")
    if os.path.exists(fts_db):
        try:
            rows = db.query(fts_db, "SELECT username FROM name2id;")
            for row in rows:
                wxid = (row.get("username") or "").strip()
                if wxid.endswith("@chatroom") and not is_ignored(wxid):
                    wxids.add(wxid)
        except Exception:
            pass

    # 来源 D：传统 message_N.db Name2Id 兜底
    try:
        for wxid in db.get_name2id().values():
            if wxid and wxid.endswith("@chatroom") and not is_ignored(wxid):
                wxids.add(wxid)
    except Exception:
        pass

    results = []
    for wxid in wxids:
        is_group = wxid.endswith("@chatroom")
        local_type = str(contact_map.get(wxid, {}).get("local_type", ""))
        is_friend = (not is_group) and local_type == "1"
        if not (is_group or is_friend):
            continue
        display = contacts.resolve_contact_name(wxid)
        results.append({
            "wxid": wxid,
            "display": display,
            "isGroup": is_group,
            "isFriend": is_friend,
            "kind": "group" if is_group else "friend",
            "ts": timestamps.get(wxid, 0),
        })

    results.sort(key=lambda c: (-c["ts"], 0 if c["isGroup"] else 1, c["display"].lower()))
    print(json.dumps(results, ensure_ascii=False))


if __name__ == "__main__":
    main()
