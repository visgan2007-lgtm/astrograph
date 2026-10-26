"""Dependency graph construction, circular-import detection, and entry-point ranking."""
from __future__ import annotations

import math
import posixpath
import sys
from collections import Counter, defaultdict, deque
from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import Iterable, Optional, Sequence

from parser import ImportRef, ParsedModule

_STDLIB = getattr(sys, "stdlib_module_names", frozenset())
_ENTRY_FILENAMES = frozenset({
    "__main__.py", "main.py", "app.py", "cli.py", "manage.py", "wsgi.py", "asgi.py", "run.py", "server.py",
    "index.js", "index.ts", "main.js", "main.ts", "app.js", "app.ts", "server.js", "server.ts", "cli.js", "cli.ts",
    "main.c", "main.cpp", "main.cc", "Main.java", "Application.java", "App.java",
    "Program.cs", "Main.cs", "Startup.cs",
})
_JS_EXTS = (".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".json")
_JS_TO_TS = {".js": (".ts", ".tsx"), ".jsx": (".tsx",), ".mjs": (".mts",), ".cjs": (".cts",)}
_NODE_BUILTINS = frozenset(
    "fs path os http https http2 crypto util events stream url child_process assert buffer zlib net tls dns readline "
    "cluster worker_threads perf_hooks timers process module vm v8 tty querystring string_decoder dgram inspector "
    "async_hooks constants punycode repl sys".split()
)
_C_SYSTEM = frozenset(
    "assert.h complex.h ctype.h errno.h fenv.h float.h inttypes.h iso646.h limits.h locale.h math.h setjmp.h signal.h "
    "stdalign.h stdarg.h stdatomic.h stdbool.h stddef.h stdint.h stdio.h stdlib.h stdnoreturn.h string.h tgmath.h "
    "threads.h time.h uchar.h wchar.h wctype.h unistd.h fcntl.h pthread.h dirent.h dlfcn.h netdb.h poll.h semaphore.h "
    "termios.h regex.h getopt.h syslog.h strings.h libgen.h glob.h grp.h pwd.h utime.h windows.h winsock2.h".split()
)
_C_SYSTEM_DIRS = frozenset({"sys", "netinet", "arpa", "linux", "net", "asm", "bits"})
_JAVA_STD = ("java.", "javax.", "jdk.", "sun.", "com.sun.")
_ENTRY_LIMIT = 10


@dataclass(slots=True)
class _EdgeAgg:
    statements: int = 0
    runtime: bool = False   # at least one module-scope (import-time) import
    calls: int = 0          # resolved call references through this dependency
    in_cycle: bool = False


def is_test_path(rel: str) -> bool:
    p = PurePosixPath(rel)
    n = p.name
    stem = n.split(".")[0]
    return (
        any(part in {"tests", "test", "__tests__", "spec", "specs", "__mocks__"} for part in p.parts[:-1])
        or n.startswith("test_")
        or n.endswith(("_test.py", "_test.go", ".test.ts", ".test.tsx", ".test.js", ".test.jsx", ".spec.ts", ".spec.tsx", ".spec.js", ".spec.jsx"))
        or n == "conftest.py"
        or stem.endswith(("Test", "Tests", "IT")) and p.suffix in {".java", ".cs"}
        or stem.endswith(("_test", "_tests")) and p.suffix in {".c", ".cpp", ".cc", ".sql"}
    )


_is_test_path = is_test_path


def _derive_module_names(paths: Iterable[str]) -> dict[str, tuple[str, bool]]:
    """Map repo-relative paths to importable dotted names, honouring `__init__.py`
    package boundaries (so `src/pkg/mod.py` -> `pkg.mod`). Returns (name, is_package)."""
    paths = list(paths)
    pkg_dirs = {PurePosixPath(p).parent.as_posix() for p in paths if PurePosixPath(p).name == "__init__.py"}
    out: dict[str, tuple[str, bool]] = {}
    for p in paths:
        pp = PurePosixPath(p)
        is_pkg = pp.name == "__init__.py"
        parts: list[str] = [] if is_pkg else [pp.stem]
        d = pp.parent
        while d.as_posix() not in {".", ""} and d.as_posix() in pkg_dirs:
            parts.append(d.name)
            d = d.parent
        name = ".".join(reversed(parts)) or (pp.parent.name or "__init__")
        out[p] = (name, is_pkg)
    return out


def strongly_connected_components(nodes: Sequence[str], adj: dict[str, set[str]]) -> list[list[str]]:
    """Iterative Tarjan SCC (no recursion-limit risk on deep import chains)."""
    index: dict[str, int] = {}
    low: dict[str, int] = {}
    on_stack: set[str] = set()
    stack: list[str] = []
    result: list[list[str]] = []
    counter = 0

    for root in nodes:
        if root in index:
            continue
        index[root] = low[root] = counter
        counter += 1
        stack.append(root)
        on_stack.add(root)
        work = [(root, iter(sorted(adj[root])))]
        while work:
            v, it = work[-1]
            descended = False
            for w in it:
                if w not in index:
                    index[w] = low[w] = counter
                    counter += 1
                    stack.append(w)
                    on_stack.add(w)
                    work.append((w, iter(sorted(adj[w]))))
                    descended = True
                    break
                if w in on_stack:
                    low[v] = min(low[v], index[w])
            if descended:
                continue
            work.pop()
            if work:
                parent = work[-1][0]
                low[parent] = min(low[parent], low[v])
            if low[v] == index[v]:
                comp: list[str] = []
                while True:
                    w = stack.pop()
                    on_stack.discard(w)
                    comp.append(w)
                    if w == v:
                        break
                result.append(comp)
    return result


class DependencyGraph:
    """Directed module graph: edge A -> B means "A depends on (imports) B"."""

    def __init__(self, modules: Sequence[ParsedModule]) -> None:
        self._modules: dict[str, ParsedModule] = {m.rel_path: m for m in modules}
        self._ids = sorted(self._modules)

        py_ids = [r for r in self._ids if self._modules[r].language == "python"]
        names = _derive_module_names(py_ids)
        self._name_of = {rel: names[rel][0] if rel in names else rel for rel in self._ids}
        self._is_pkg = {rel: names[rel][1] if rel in names else False for rel in self._ids}
        self._id_by_name: dict[str, str] = {}  # dotted names resolve Python imports only
        for rel in py_ids:
            self._id_by_name.setdefault(self._name_of[rel], rel)

        # Symbol tables for languages that import by name (Java FQNs, C# namespaces, SQL objects).
        self._sym: dict[tuple[str, str], list[str]] = defaultdict(list)
        self._java_pkg: dict[str, list[str]] = defaultdict(list)
        self._basename: dict[str, list[str]] = defaultdict(list)
        for rel in self._ids:
            m = self._modules[rel]
            self._basename[PurePosixPath(rel).name].append(rel)
            for sym in m.provides:
                if rel not in self._sym[(m.language, sym)]:
                    self._sym[(m.language, sym)].append(rel)
                if m.language == "java" and "." in sym:
                    self._java_pkg[sym.rpartition(".")[0]].append(rel)

        self._edges: dict[tuple[str, str], _EdgeAgg] = {}
        self._external: dict[str, set[str]] = defaultdict(set)
        self._build_edges()

        self._adj_all: dict[str, set[str]] = {i: set() for i in self._ids}
        self._radj_all: dict[str, set[str]] = {i: set() for i in self._ids}
        self._adj_runtime: dict[str, set[str]] = {i: set() for i in self._ids}
        for (src, dst), agg in self._edges.items():
            self._adj_all[src].add(dst)
            self._radj_all[dst].add(src)
            if agg.runtime:
                self._adj_runtime[src].add(dst)

        self.cycles = self._detect_cycles()
        self.entry_points = self._rank_entry_points()

    # -- resolution -------------------------------------------------------- #
    def _lookup(self, dotted: str) -> Optional[str]:
        """Longest-prefix match of a dotted path onto an internal module."""
        parts = dotted.split(".") if dotted else []
        for i in range(len(parts), 0, -1):
            hit = self._id_by_name.get(".".join(parts[:i]))
            if hit:
                return hit
        return None

    def _package_of(self, rel: str) -> str:
        name = self._name_of[rel]
        return name if self._is_pkg[rel] else name.rpartition(".")[0]

    def _absolute_base(self, rel: str, ref: ImportRef) -> Optional[str]:
        if ref.level == 0:
            return ref.module
        pkg_parts = [p for p in self._package_of(rel).split(".") if p]
        up = ref.level - 1
        if up > len(pkg_parts):
            return None
        base = pkg_parts[: len(pkg_parts) - up]
        if ref.module:
            base += ref.module.split(".")
        return ".".join(base)

    def _resolve_import(
        self, rel: str, ref: ImportRef, bindings: dict[str, str]
    ) -> tuple[list[str], Optional[str]]:
        """Return (internal target ids, external top-level package or None)."""
        targets: list[str] = []
        if ref.is_from:
            base = self._absolute_base(rel, ref)
            if base is None:
                return [], None
            need_base = False
            for name, asname in ref.names:
                if name == "*":
                    need_base = True
                    continue
                sub = f"{base}.{name}" if base else name
                bindings[asname or name] = sub
                hit = self._id_by_name.get(sub)
                if hit:
                    targets.append(hit)
                else:
                    need_base = True
            if need_base and base:
                hit = self._lookup(base)
                if hit:
                    targets.append(hit)
            top = base.split(".")[0] if base else ""
            external = top if (ref.level == 0 and not targets and top) else None
        else:
            head = ref.module.split(".")[0]
            bindings[ref.asname or head] = ref.module if ref.asname else head
            hit = self._lookup(ref.module)
            if hit:
                targets.append(hit)
            external = None if hit else head

        if external and (external in _STDLIB or external == "__future__"):
            external = None
        return targets, external

    # -- non-Python resolution --------------------------------------------- #
    def _closest(self, rel: str, ids: list[str]) -> Optional[str]:
        """Among several candidate files, prefer the one sharing the longest directory prefix."""
        if not ids:
            return None
        here = PurePosixPath(rel).parent.parts
        def shared(i: str) -> int:
            n = 0
            for a, b in zip(here, PurePosixPath(i).parent.parts):
                if a != b:
                    break
                n += 1
            return n
        return sorted(ids, key=lambda i: (-shared(i), i))[0]

    def _suffix_match(self, rel: str, spec: str) -> Optional[str]:
        norm = posixpath.normpath(spec).lstrip("./")
        hits = [i for i in self._basename.get(PurePosixPath(norm).name, []) if i == norm or i.endswith("/" + norm)]
        return self._closest(rel, hits)

    def _js_candidate(self, base: str) -> Optional[str]:
        if base.startswith(".."):
            return None
        stem, ext = posixpath.splitext(base)
        cands = [base] + [stem + e for e in _JS_TO_TS.get(ext, ())]
        cands += [base + e for e in _JS_EXTS] + [f"{base}/index{e}" for e in _JS_EXTS]
        return next((c for c in cands if c in self._modules), None)

    def _resolve_js(self, rel: str, spec: str) -> tuple[list[str], Optional[str]]:
        if spec.startswith("node:"):
            return [], None
        if spec.startswith("."):
            hit = self._js_candidate(posixpath.normpath(posixpath.join(posixpath.dirname(rel), spec)))
            return ([hit] if hit else []), None  # unresolved relative import is usually an asset (css, svg)
        for prefix, roots in (("@/", ("src", "")), ("~/", ("src", "")), ("src/", ("",))):
            if spec.startswith(prefix):
                for root in roots:
                    hit = self._js_candidate(posixpath.join(root, spec[len(prefix):]) if root else spec)
                    if hit:
                        return [hit], None
        parts = spec.split("/")
        pkg = "/".join(parts[:2]) if spec.startswith("@") else parts[0]
        return [], (None if pkg in _NODE_BUILTINS else pkg)

    def _resolve_include(self, rel: str, spec: str, system: bool) -> tuple[list[str], Optional[str]]:
        spec = spec.replace("\\", "/")
        if not system:
            local = posixpath.normpath(posixpath.join(posixpath.dirname(rel), spec))
            if local in self._modules:
                return [local], None
        hit = self._suffix_match(rel, spec)
        if hit:
            return [hit], None
        base = PurePosixPath(spec)
        first = base.parts[0] if base.parts else spec
        if "." not in base.name or base.name in _C_SYSTEM or first in _C_SYSTEM_DIRS:
            return [], None  # C++ standard library / libc / POSIX headers
        return [], (first if len(base.parts) > 1 else base.stem)

    def _resolve_java(self, ref: ImportRef) -> tuple[list[str], Optional[str]]:
        fqn = ref.module
        if ref.names == ("*",):
            ids = list(self._java_pkg.get(fqn, []))
        else:
            ids, probe = [], fqn
            for _ in range(3):  # nested class / static member imports
                ids = self._sym.get(("java", probe), [])
                if ids or "." not in probe:
                    break
                probe = probe.rpartition(".")[0]
        if ids:
            return list(ids), None
        if fqn.startswith(_JAVA_STD):
            return [], None
        return [], ".".join(fqn.split(".")[:2])

    def _resolve_csharp(self, ref: ImportRef) -> tuple[list[str], Optional[str]]:
        ns = ref.module
        for probe in (ns, ns.rpartition(".")[0]):  # `using static Ns.Type` points one level deeper
            ids = self._sym.get(("csharp", probe), [])
            if ids:
                return list(ids), None
        top = ns.split(".")[0]
        return [], (None if top == "System" else top)

    def _resolve_sql(self, rel: str, name: str) -> tuple[list[str], Optional[str]]:
        ids = self._sym.get(("sql", name)) or self._sym.get(("sql", name.rpartition(".")[2]), [])
        return [i for i in ids if i != rel], None  # unresolved names are CTEs, system or external tables

    def _resolve_foreign(self, rel: str, lang: str, ref: ImportRef) -> tuple[list[str], Optional[str]]:
        if ref.kind == "path":
            if lang in {"javascript", "typescript"}:
                return self._resolve_js(rel, ref.module)
            if lang in {"c", "cpp"}:
                return self._resolve_include(rel, ref.module, ref.system)
            hit = self._suffix_match(rel, ref.module)  # SQL `\i other.sql`
            return ([hit] if hit else []), None
        if ref.kind == "symbol":
            return self._resolve_java(ref) if lang == "java" else self._resolve_csharp(ref)
        if ref.kind == "sql":
            return self._resolve_sql(rel, ref.module)
        return [], None

    # -- construction ------------------------------------------------------ #
    def _build_edges(self) -> None:
        for rel in self._ids:
            mod = self._modules[rel]
            bindings: dict[str, str] = {}
            for ref in mod.imports:
                if mod.language != "python":
                    targets, external = self._resolve_foreign(rel, mod.language, ref)
                else:
                    targets, external = self._resolve_import(rel, ref, bindings)
                if external:
                    self._external[rel].add(external)
                for target in targets:
                    if target == rel:
                        continue
                    agg = self._edges.setdefault((rel, target), _EdgeAgg())
                    agg.statements += 1
                    if ref.scope == "module":
                        agg.runtime = True

            # Attribute call references to dependency edges via import bindings.
            for call in mod.calls:
                root, _, rest = call.name.partition(".")
                bound = bindings.get(root)
                if not bound:
                    continue
                target = self._lookup(f"{bound}.{rest}" if rest else bound)
                if target and target != rel and (rel, target) in self._edges:
                    self._edges[(rel, target)].calls += 1

    # -- cycles ------------------------------------------------------------ #
    @staticmethod
    def _shortest_cycle(start: str, members: set[str], adj: dict[str, set[str]]) -> list[str]:
        prev: dict[str, str] = {}
        queue: deque[str] = deque([start])
        seen = {start}
        while queue:
            cur = queue.popleft()
            for nxt in sorted(adj[cur] & members):
                if nxt == start:
                    path = [cur]
                    while path[-1] != start:
                        path.append(prev[path[-1]])
                    path.reverse()
                    return path + [start]
                if nxt not in seen:
                    seen.add(nxt)
                    prev[nxt] = cur
                    queue.append(nxt)
        return [start]

    def _detect_cycles(self) -> list[dict]:
        """Cycles over import-time edges only; function-level and TYPE_CHECKING
        imports are deferred and cannot cause an ImportError at load time."""
        cycles: list[dict] = []
        for comp in strongly_connected_components(self._ids, self._adj_runtime):
            if len(comp) < 2:
                continue
            members = set(comp)
            start = min(members)
            cycles.append({
                "members": sorted(members),
                "path": self._shortest_cycle(start, members, self._adj_runtime),
            })
        cycles.sort(key=lambda c: (-len(c["members"]), c["members"][0]))
        for idx, cyc in enumerate(cycles):
            cyc["id"] = idx
            member_set = set(cyc["members"])
            for src in cyc["members"]:
                for dst in self._adj_runtime[src] & member_set:
                    self._edges[(src, dst)].in_cycle = True
        return cycles

    # -- entry points ------------------------------------------------------ #
    def _reach(self, start: str) -> int:
        seen = {start}
        queue: deque[str] = deque([start])
        while queue:
            cur = queue.popleft()
            for nxt in self._adj_all[cur]:
                if nxt not in seen:
                    seen.add(nxt)
                    queue.append(nxt)
        return len(seen) - 1

    def _rank_entry_points(self) -> list[dict]:
        n = len(self._ids)
        ranked: list[dict] = []
        for rel in self._ids:
            mod = self._modules[rel]
            fname = PurePosixPath(rel).name
            score, reasons = 0.0, []
            if mod.has_main_guard:
                score += 5
                reasons.append(
                    "defines an `if __name__ == '__main__'` guard" if mod.language == "python"
                    else "defines a program entry function (`main`)"
                )
            if fname in _ENTRY_FILENAMES:
                score += 3
                reasons.append(f"conventional entry filename `{fname}`")
            if not self._radj_all[rel] and fname != "__init__.py":
                score += 2
                reasons.append("not imported by any other module")
            if _is_test_path(rel):
                score -= 4
            if score <= 1.5:
                continue
            reach = self._reach(rel)
            if reach:
                score += 3 * reach / max(1, n - 1)
                reasons.append(f"transitively reaches {reach} module(s)")
            ranked.append({"id": rel, "score": round(score, 2), "reasons": reasons})
        ranked.sort(key=lambda r: (-r["score"], r["id"]))
        return ranked[:_ENTRY_LIMIT]

    # -- serialisation ----------------------------------------------------- #
    def to_payload(self) -> dict:
        entry_ids = {e["id"] for e in self.entry_points if e["score"] >= 3}
        cycle_of = {m: c["id"] for c in self.cycles for m in c["members"]}
        entry_score = {e["id"]: e["score"] for e in self.entry_points}

        nodes = []
        for rel in self._ids:
            mod = self._modules[rel]
            name = self._name_of[rel]
            label = name if self._id_by_name.get(name) == rel else rel
            nodes.append({
                "id": rel,
                "label": label,
                "path": rel,
                "loc": mod.loc,
                "complexity": mod.complexity,
                "in_degree": len(self._radj_all[rel]),
                "out_degree": len(self._adj_all[rel]),
                "is_entry": rel in entry_ids,
                "entry_score": entry_score.get(rel),
                "cycle_id": cycle_of.get(rel),
                "has_main_guard": mod.has_main_guard,
                "language": mod.language,
                "parse_error": mod.error,
                "classes": [
                    {"name": c.name, "lineno": c.lineno, "bases": c.bases, "methods": len(c.methods), "kind": c.kind}
                    for c in mod.classes[:50]
                ],
                "functions": [
                    {"name": f.qualname, "lineno": f.lineno, "complexity": f.complexity}
                    for f in sorted(mod.functions, key=lambda f: -f.complexity)[:50]
                ],
                "external_deps": sorted(self._external.get(rel, ())),
            })

        edges = [
            {
                "id": f"{src}->{dst}",
                "source": src,
                "target": dst,
                "runtime": agg.runtime,
                "weight": agg.statements,
                "calls": agg.calls,
                "in_cycle": agg.in_cycle,
            }
            for (src, dst), agg in sorted(self._edges.items())
        ]

        total_loc = sum(m.loc for m in self._modules.values())
        stats = {
            "modules": len(nodes),
            "edges": len(edges),
            "cycles": len(self.cycles),
            "loc": total_loc,
            "parse_errors": sum(1 for m in self._modules.values() if m.error),
            "avg_complexity": round(sum(m.complexity for m in self._modules.values()) / max(1, len(nodes)), 2),
            "max_depth_hint": math.ceil(math.log2(len(nodes) + 1)) if nodes else 0,
        }
        return {
            "nodes": nodes,
            "edges": edges,
            "cycles": self.cycles,
            "entry_points": self.entry_points,
            "languages": dict(sorted(Counter(m.language for m in self._modules.values()).items(), key=lambda kv: -kv[1])),
            "stats": stats,
        }
