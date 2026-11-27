#!/usr/bin/env python3
"""Decrypt WeChat dbs under db_storage into the plaintext DECRYPTED_DIR (Windows sqlite3 backend).

After extract_raw_key.py yields the raw key, this builds or incrementally refreshes a plaintext
mirror so query.py / list_sessions.py / server.py (config.DB_BACKEND='sqlite3') can read it like
macOS reads the encrypted store directly. Preserves the {wxid}_{device}/db_storage/... layout.

Usage:
  python decrypt_all.py [raw_key_hex] [--incremental] [--core-only] [--json]
(raw key defaults to ../../key_windows.txt).
"""
import argparse
import glob
import hashlib
import hmac
import json
import os
import re
import struct
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "common"))
from crypto_backend import aes_cbc_decrypt as _aes_cbc_dec
from wal_snapshot import read_snapshot

SKILL_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DECRYPTED_DIR = os.path.join(SKILL_DIR, "decrypted")
PAGE, RESERVE, SALT_SZ = 4096, 80, 16
SYNC_META_FILE = ".sync_meta.json"


def is_core_db(rel: str) -> bool:
    """Only databases needed by 轻松日程 (sessions, contacts, messages & FTS)."""
    norm = rel.replace("\\", "/").lower()
    if norm in ("session/session.db", "contact/contact.db", "message/message_fts.db"):
        return True
    if re.fullmatch(r"message/message_\d+\.db", norm):
        return True
    return False


def _remove_wal_sidecars(dst: str) -> None:
    """Remove stale SQLite WAL/SHM sidecars after replacing a decrypted .db file."""
    for suffix in ("-wal", "-shm"):
        sidecar = dst + suffix
        try:
            if os.path.exists(sidecar):
                os.unlink(sidecar)
        except OSError:
            pass


def decrypt_db(raw: bytes, src: str, dst: str) -> bool:
    """Decrypt one SQLCipher v4 db to plaintext sqlite. Returns False if key/format mismatch."""
    try:
        data = read_snapshot(src)
    except ValueError:
        return False
    if len(data) < PAGE or len(data) % PAGE:
        return False
    salt = data[:SALT_SZ]
    enc = hashlib.pbkdf2_hmac("sha512", raw, salt, 256000, 32)
    mac_salt = bytes(value ^ 0x3A for value in salt)
    mac_key = hashlib.pbkdf2_hmac("sha512", enc, mac_salt, 2, 32)
    for number in range(1, len(data) // PAGE + 1):
        page = data[(number - 1) * PAGE:number * PAGE]
        offset = SALT_SZ if number == 1 else 0
        expected = hmac.new(mac_key, page[offset:PAGE - 64] + struct.pack("<I", number), hashlib.sha512).digest()
        if not hmac.compare_digest(expected, page[PAGE - 64:PAGE]):
            return False
    rstart = PAGE - RESERVE
    # verify page 1 header before committing
    iv0 = data[rstart:rstart + 16]
    pt0 = _aes_cbc_dec(enc, iv0, data[SALT_SZ:rstart])
    if not (pt0[0] == 0x10 and pt0[1] == 0x00 and pt0[4] == 0x50 and pt0[5] == 0x40 and pt0[7] == 0x20):
        return False
    out = bytearray(b"SQLite format 3\x00")
    out += pt0 + data[rstart:PAGE]
    for i in range(1, len(data) // PAGE):
        page = data[i * PAGE:(i + 1) * PAGE]
        iv = page[rstart:rstart + 16]
        out += _aes_cbc_dec(enc, iv, page[:rstart]) + page[rstart:]
    parent = os.path.dirname(dst)
    os.makedirs(parent, mode=0o700, exist_ok=True)
    try:
        os.chmod(parent, 0o700)
    except OSError:
        pass
    fd, tmp_path = tempfile.mkstemp(prefix=os.path.basename(dst) + ".", dir=parent)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(out)
        try:
            os.chmod(tmp_path, 0o600)
        except OSError:
            pass
        os.replace(tmp_path, dst)
        _remove_wal_sidecars(dst)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise
    return True


def _candidate_xwechat_roots() -> list[str]:
    """Discover possible xwechat_files roots on Windows (env -> xwechat ini -> registry -> default)."""
    roots: list[str] = []
    seen: set[str] = set()

    def add(p: str) -> None:
        if not p:
            return
        p = os.path.normpath(os.path.expandvars(os.path.expanduser(p.strip().strip('"'))))
        if not p:
            return
        candidates = [p]
        if os.path.basename(p).lower() != "xwechat_files":
            candidates.append(os.path.join(p, "xwechat_files"))
        for c in candidates:
            key = c.lower()
            if key not in seen and os.path.isdir(c):
                seen.add(key)
                roots.append(c)

    env_root = os.environ.get("WECHAT_DATA_ROOT")
    if env_root:
        add(env_root)

    # 微信 4.x 会把自定义文件存储路径写入 %APPDATA%\Tencent\xwechat\config\*.ini
    appdata = os.environ.get("APPDATA")
    if appdata:
        cfg_dir = os.path.join(appdata, "Tencent", "xwechat", "config")
        if os.path.isdir(cfg_dir):
            for ini in glob.glob(os.path.join(cfg_dir, "*.ini")):
                try:
                    with open(ini, "r", encoding="utf-8", errors="ignore") as f:
                        for line in f:
                            text = line.strip()
                            if text and (":\\" in text or ":/" in text):
                                add(text)
                except OSError:
                    pass

    # 注册表兜底
    if os.name == "nt":
        try:
            import winreg
            for sub in (r"Software\Tencent\Weixin", r"Software\Tencent\WeChat"):
                try:
                    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, sub) as k:
                        val, _ = winreg.QueryValueEx(k, "FileSavePath")
                        if isinstance(val, str) and val and val != "MyDocument:":
                            add(val)
                except OSError:
                    pass
        except ImportError:
            pass

    add(os.path.expanduser(r"~/Documents/xwechat_files"))
    return roots


def _latest_activity_mtime(db_storage_dir: str) -> float:
    latest = 0.0
    try:
        latest = os.path.getmtime(db_storage_dir)
    except OSError:
        pass
    for pat in (
        os.path.join(db_storage_dir, "session", "session.db*"),
        os.path.join(db_storage_dir, "message", "message_0.db*"),
        os.path.join(db_storage_dir, "message", "message_fts.db*"),
    ):
        for p in glob.glob(pat):
            try:
                mt = os.path.getmtime(p)
                if mt > latest:
                    latest = mt
            except OSError:
                pass
    return latest


def find_storage_roots():
    found: list[str] = []
    seen: set[str] = set()
    for root in _candidate_xwechat_roots():
        for match in glob.glob(os.path.join(root, "*", "db_storage")):
            key = os.path.normpath(match).lower()
            if key not in seen and os.path.isdir(match):
                seen.add(key)
                found.append(match)
    return found


def _source_signature(src: str) -> dict:
    def stat_pair(p: str):
        try:
            st = os.stat(p)
            return [st.st_size, st.st_mtime_ns]
        except OSError:
            return None

    return {
        "db": stat_pair(src),
        "wal": stat_pair(src + "-wal"),
    }


def _load_sync_meta(dst_root: str) -> dict:
    meta_path = os.path.join(dst_root, SYNC_META_FILE)
    try:
        with open(meta_path, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _save_sync_meta(dst_root: str, meta: dict) -> None:
    os.makedirs(dst_root, exist_ok=True)
    meta_path = os.path.join(dst_root, SYNC_META_FILE)
    tmp_path = meta_path + ".tmp"
    try:
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(meta, f, ensure_ascii=False, indent=2)
        os.replace(tmp_path, meta_path)
    except OSError:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


def parse_args(argv):
    parser = argparse.ArgumentParser(description="Decrypt Windows WeChat 4.x SQLCipher databases.")
    parser.add_argument("raw_key_hex", nargs="?", default=None, help="Optional 64-char hex raw key")
    parser.add_argument("--incremental", action="store_true", help="Skip databases unchanged since last sync")
    parser.add_argument("--core-only", action="store_true", help="Only decrypt session/contact/message databases")
    parser.add_argument("--json", dest="as_json", action="store_true", help="Print JSON summary to stdout")
    return parser.parse_args(argv)


def main():
    args = parse_args(sys.argv[1:])

    if args.raw_key_hex:
        raw_hex = args.raw_key_hex.strip()
    else:
        key_path = os.path.join(SKILL_DIR, "key_windows.txt")
        try:
            with open(key_path, encoding="ascii") as f:
                raw_hex = f.read().strip()
        except OSError as exc:
            raise SystemExit(f"ERR: missing {key_path}; run extract_raw_key.py first") from exc
    try:
        raw = bytes.fromhex(raw_hex)
    except ValueError as exc:
        raise SystemExit("ERR: raw key must be hexadecimal") from exc
    if len(raw) != 32 or len(raw_hex) != 64:
        raise SystemExit("ERR: raw key must be exactly 64 hexadecimal characters")

    src_roots = find_storage_roots()
    if not src_roots:
        msg = "ERR: no encrypted db_storage found; set WECHAT_DATA_ROOT to the xwechat_files directory if moved"
        if args.as_json:
            print(json.dumps({"ok": False, "error": msg}, ensure_ascii=False))
        else:
            print(msg)
        sys.exit(1)

    src_root = max(src_roots, key=_latest_activity_mtime)
    account = os.path.basename(os.path.dirname(src_root))  # {wxid}_{device}
    dst_root = os.path.join(DECRYPTED_DIR, account, "db_storage")
    meta = _load_sync_meta(dst_root) if args.incremental else {}
    meta_files = meta.get("files") if isinstance(meta.get("files"), dict) else {}

    ok = unchanged = skip = 0
    errors = []
    for src in sorted(glob.glob(os.path.join(src_root, "**", "*.db"), recursive=True)):
        rel = os.path.relpath(src, src_root)
        if args.core_only and not is_core_db(rel):
            continue
        dst = os.path.join(dst_root, rel)
        rel_key = rel.replace("\\", "/")
        sig = _source_signature(src)
        if args.incremental and os.path.exists(dst) and meta_files.get(rel_key) == sig:
            unchanged += 1
            if not args.as_json:
                print("SAME", rel)
            continue
        try:
            if decrypt_db(raw, src, dst):
                ok += 1
                meta_files[rel_key] = sig
                if not args.as_json:
                    print("OK  ", rel)
            else:
                skip += 1
                if not args.as_json:
                    print("skip", rel, "(key/format mismatch or empty)")
        except Exception as e:
            skip += 1
            errors.append(f"{rel}: {e}")
            if not args.as_json:
                print("ERR ", rel, e)

    if ok or unchanged:
        _save_sync_meta(dst_root, {"srcRoot": src_root, "files": meta_files})

    summary = {
        "ok": (ok + unchanged) > 0,
        "srcRoot": src_root,
        "dstRoot": dst_root,
        "decrypted": ok,
        "unchanged": unchanged,
        "skipped": skip,
        "errors": errors,
    }
    if args.as_json:
        print(json.dumps(summary, ensure_ascii=False))
    else:
        print(f"\n{ok} decrypted, {unchanged} unchanged, {skip} skipped -> {dst_root}")
        if ok or unchanged:
            print(">>> plaintext store ready; server.py / export_chat.py can now read it <<<")
    if not (ok or unchanged):
        sys.exit(1)


if __name__ == "__main__":
    main()
