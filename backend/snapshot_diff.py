"""SQLite-backed analysis snapshots and snapshot-to-snapshot comparison."""
from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import zlib
from contextlib import closing
from datetime import datetime, timezone
from typing import Optional

DB_PATH = os.getenv("ASTROGRAPH_DB", "astrograph.db")
_SCHEMA = """
CREATE TABLE IF NOT EXISTS snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_hash TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL,
  stats TEXT NOT NULL,
  payload BLOB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_snapshots_source ON snapshots(source, id);
"""


def content_hash(payload: dict) -> str:
    """Stable fingerprint of the graph itself (ignores tour, repository label, timestamps)."""
    core = {
        "n": sorted((n["id"], n["loc"], n["complexity"]) for n in payload["nodes"]),
        "e": sorted((e["id"], e["runtime"]) for e in payload["edges"]),
    }
    return hashlib.sha256(json.dumps(core, separators=(",", ":")).encode()).hexdigest()


class SnapshotStore:
    def __init__(self, path: str = DB_PATH) -> None:
        self.path = path
        with self._conn() as c:
            c.executescript(_SCHEMA)

    def _conn(self) -> sqlite3.Connection:
        c = sqlite3.connect(self.path, timeout=10)
        c.row_factory = sqlite3.Row
        return c

    def save(self, payload: dict, source: str) -> dict:
        h = content_hash(payload)
        with closing(self._conn()) as c, c:
            row = c.execute("SELECT id, content_hash, source, created_at FROM snapshots WHERE content_hash=? AND source=?", (h, source)).fetchone()
            if row:
                return {**dict(row), "deduped": True}
            try:
                cur = c.execute(
                    "INSERT INTO snapshots(content_hash, source, created_at, stats, payload) VALUES (?,?,?,?,?)",
                    (h, source, datetime.now(timezone.utc).isoformat(timespec="seconds"), json.dumps(payload["stats"]),
                     zlib.compress(json.dumps(payload).encode())),
                )
            except sqlite3.IntegrityError:  # same graph already stored under another source label
                h = f"{h}:{hashlib.sha1(source.encode()).hexdigest()[:8]}"
                cur = c.execute(
                    "INSERT INTO snapshots(content_hash, source, created_at, stats, payload) VALUES (?,?,?,?,?)",
                    (h, source, datetime.now(timezone.utc).isoformat(timespec="seconds"), json.dumps(payload["stats"]),
                     zlib.compress(json.dumps(payload).encode())),
                )
            row = c.execute("SELECT id, content_hash, source, created_at FROM snapshots WHERE id=?", (cur.lastrowid,)).fetchone()
            return {**dict(row), "deduped": False}

    def list(self, source: Optional[str] = None, limit: int = 50) -> list[dict]:
        q, args = "SELECT id, content_hash, source, created_at, stats FROM snapshots", []
        if source:
            q += " WHERE source=?"
            args.append(source)
        q += " ORDER BY id DESC LIMIT ?"
        args.append(limit)
        with closing(self._conn()) as c:
            return [{**{k: r[k] for k in ("id", "content_hash", "source", "created_at")}, "stats": json.loads(r["stats"])}
                    for r in c.execute(q, args)]

    def get(self, ref: str | int) -> dict:
        """`ref` is a numeric revision id or a content-hash prefix (min 6 chars)."""
        ref = str(ref)
        with closing(self._conn()) as c:
            if ref.isdigit():
                rows = c.execute("SELECT * FROM snapshots WHERE id=?", (int(ref),)).fetchall()
            elif len(ref) >= 6 and all(ch in "0123456789abcdef:" for ch in ref):
                rows = c.execute("SELECT * FROM snapshots WHERE content_hash LIKE ? LIMIT 2", (ref + "%",)).fetchall()
            else:
                rows = []
        if len(rows) != 1:
            raise KeyError(f"Snapshot {ref!r} not found" if not rows else f"Snapshot prefix {ref!r} is ambiguous")
        r = rows[0]
        return {"id": r["id"], "content_hash": r["content_hash"], "source": r["source"],
                "created_at": r["created_at"], "payload": json.loads(zlib.decompress(r["payload"]))}


def diff_snapshots(base: dict, head: dict) -> dict:
    """Categorise nodes and edges as added / removed / unchanged (head relative to base)."""
    bn = {n["id"]: n for n in base["payload"]["nodes"]}
    hn = {n["id"]: n for n in head["payload"]["nodes"]}
    be = {e["id"]: e for e in base["payload"]["edges"]}
    he = {e["id"]: e for e in head["payload"]["edges"]}

    node_status = {i: ("unchanged" if i in bn else "added") for i in hn} | {i: "removed" for i in bn if i not in hn}
    edge_status = {i: ("unchanged" if i in be else "added") for i in he} | {i: "removed" for i in be if i not in he}

    def tally(status: dict[str, str]) -> dict[str, int]:
        return {k: sum(1 for v in status.values() if v == k) for k in ("added", "removed", "unchanged")}

    deltas = {i: {"loc": hn[i]["loc"] - bn[i]["loc"], "complexity": hn[i]["complexity"] - bn[i]["complexity"]}
              for i in hn if i in bn and (hn[i]["loc"] != bn[i]["loc"] or hn[i]["complexity"] != bn[i]["complexity"])}

    # Merged graph so the canvas can draw removed items next to the surviving ones.
    nodes = list(head["payload"]["nodes"]) + [bn[i] for i, s in node_status.items() if s == "removed"]
    edges = list(head["payload"]["edges"]) + [be[i] for i, s in edge_status.items() if s == "removed"]
    merged = {**head["payload"], "nodes": nodes, "edges": edges}
    merged["stats"] = {**head["payload"]["stats"], "modules": len(nodes), "edges": len(edges)}

    meta = lambda s: {k: s[k] for k in ("id", "content_hash", "source", "created_at")}  # noqa: E731
    return {
        "base": meta(base), "head": meta(head),
        "summary": {"nodes": tally(node_status), "edges": tally(edge_status)},
        "node_status": node_status, "edge_status": edge_status, "deltas": deltas,
        "changed_edges": [{"id": i, "source": (he.get(i) or be[i])["source"], "target": (he.get(i) or be[i])["target"], "status": s}
                          for i, s in sorted(edge_status.items()) if s != "unchanged"],
        "graph": merged,
    }
