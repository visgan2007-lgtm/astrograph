"""Onboarding Pathfinder: ranks modules into a guided reading order for new contributors.

Signals: PageRank centrality on the *dependents* graph, fan-in / fan-out, dependency depth
(longest import chain below a module, with cycles collapsed), plus entry-point bonus.
"""
from __future__ import annotations

from collections import deque

from graph_engine import is_test_path, strongly_connected_components

DEFAULT_LIMIT = 12


def _pagerank(ids: list[str], out: dict[str, set[str]], d: float = 0.85, iters: int = 40) -> dict[str, float]:
    """Rank flows from importer to imported, so widely depended-on modules score high."""
    n = len(ids)
    rank = {i: 1.0 / n for i in ids}
    for _ in range(iters):
        nxt = {i: (1 - d) / n for i in ids}
        sink = sum(rank[i] for i in ids if not out[i])
        for i in ids:
            if out[i]:
                share = d * rank[i] / len(out[i])
                for j in out[i]:
                    nxt[j] += share
            nxt[i] += d * sink / n
        rank = nxt
    return rank


def _depths(ids: list[str], out: dict[str, set[str]]) -> dict[str, int]:
    """Depth 0 = imports nothing internal. Cycles are collapsed into one level."""
    comps = strongly_connected_components(ids, out)
    comp_of = {m: k for k, c in enumerate(comps) for m in c}
    cdeps: dict[int, set[int]] = {k: set() for k in range(len(comps))}
    for a in ids:
        for b in out[a]:
            if comp_of[a] != comp_of[b]:
                cdeps[comp_of[a]].add(comp_of[b])
    memo: dict[int, int] = {}

    def depth(k: int) -> int:  # iterative post-order to avoid recursion limits
        stack = [k]
        while stack:
            cur = stack[-1]
            pending = [c for c in cdeps[cur] if c not in memo]
            if pending:
                stack.extend(pending)
                continue
            memo[cur] = 1 + max((memo[c] for c in cdeps[cur]), default=-1)
            stack.pop()
        return memo[k]

    return {i: depth(comp_of[i]) for i in ids}


def _routes(entries: list[str], out: dict[str, set[str]]) -> dict[str, list[str]]:
    """Shortest import chain from any entry point to every reachable module (BFS)."""
    route = {e: [e] for e in entries}
    queue = deque(entries)
    while queue:
        cur = queue.popleft()
        for nxt in sorted(out[cur]):
            if nxt not in route:
                route[nxt] = route[cur] + [nxt]
                queue.append(nxt)
    return route


def _norm(values: dict[str, float]) -> dict[str, float]:
    hi = max(values.values(), default=0) or 1.0
    return {k: v / hi for k, v in values.items()}


def build_tour(payload: dict, limit: int = DEFAULT_LIMIT) -> list[dict]:
    nodes = {n["id"]: n for n in payload["nodes"]}
    if not nodes:
        return []
    ids = sorted(nodes)
    out: dict[str, set[str]] = {i: set() for i in ids}
    for e in payload["edges"]:
        out[e["source"]].add(e["target"])

    pr = _norm(_pagerank(ids, out))
    fan_in = _norm({i: float(nodes[i]["in_degree"]) for i in ids})
    depth = _depths(ids, out)
    max_depth = max(depth.values()) or 1
    entry_score = {e["id"]: e["score"] for e in payload.get("entry_points", [])}
    entries = [i for i, s in sorted(entry_score.items(), key=lambda kv: -kv[1]) if s >= 3] or list(entry_score)[:1]
    route = _routes(entries, out)
    cx_hi = max((n["complexity"] for n in nodes.values()), default=1) or 1

    scored = []
    for i in ids:
        n = nodes[i]
        if n.get("parse_error") or is_test_path(n["path"]):
            continue
        readability = 1 - min(1.0, n["complexity"] / cx_hi)
        score = 0.40 * pr[i] + 0.25 * fan_in[i] + 0.20 * (1.0 if i in entry_score and entry_score[i] >= 3 else 0.0) + 0.15 * readability
        scored.append((score, i))
    scored.sort(key=lambda t: (-t[0], t[1]))
    picked = [i for _, i in scored[:limit]]
    score_of = dict((i, s) for s, i in scored)

    def stage(i: str) -> int:
        if entry_score.get(i, 0) >= 3:
            return 0  # orient: how the app starts
        return 1 if depth[i] <= max(1, max_depth // 3) else 2  # foundations, then core logic

    picked.sort(key=lambda i: (stage(i), depth[i] if stage(i) else 0, -score_of[i], i))
    stage_name = ("Orient", "Foundations", "Core logic")

    tour = []
    for rank, i in enumerate(picked, start=1):
        n = nodes[i]
        why: list[str] = []
        if stage(i) == 0:
            why.append(f"Start here: entry point ({'; '.join(next((e['reasons'] for e in payload['entry_points'] if e['id'] == i), []))}).")
        if n["in_degree"]:
            why.append(f"Imported by {n['in_degree']} module(s), so changes here ripple outward.")
        if depth[i] == 0:
            why.append("Imports nothing internal, so it can be read in isolation.")
        elif stage(i):
            why.append(f"Sits {depth[i]} level(s) above the leaf modules it builds on.")
        if n["out_degree"] >= 5:
            why.append(f"Coordinates {n['out_degree']} dependencies, a good map of the surrounding code.")
        if n["complexity"] >= 0.7 * cx_hi and n["complexity"] > 10:
            why.append(f"High complexity ({n['complexity']}); read after the modules around it.")
        if n["cycle_id"] is not None:
            why.append(f"Part of circular-import cluster #{n['cycle_id'] + 1}; expect tight coupling.")
        tour.append({
            "rank": rank,
            "id": i,
            "label": n["label"],
            "stage": stage_name[stage(i)],
            "score": round(score_of[i], 3),
            "metrics": {
                "centrality": round(pr[i], 3), "fan_in": n["in_degree"], "fan_out": n["out_degree"],
                "depth": depth[i], "loc": n["loc"], "complexity": n["complexity"],
            },
            "why": " ".join(why) or "Representative module for its area of the codebase.",
            "route": route.get(i, [i]),
        })
    return tour
