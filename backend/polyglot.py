"""Static analysis for C, C++, Java, JavaScript, TypeScript, C# and SQL.

Pure-regex + brace-matching: source is never compiled or executed. Comments and string
contents are blanked (length and newlines preserved) before any structural scan, so keywords
inside strings or comments never produce false imports, functions, or complexity.
"""
from __future__ import annotations

import re
from bisect import bisect_right
from typing import Callable, Optional

from parser_models import ClassInfo, FunctionInfo, ImportRef, ParsedModule

# --------------------------------------------------------------------------- #
# 1. Comment / string blanking
# --------------------------------------------------------------------------- #
_COMMON = r"""
    (?P<lc>//[^\n]*)
  | (?P<bc>/\*.*?\*/)
"""
_STR_C = r"""
  | (?P<s1>"(?:\\.|[^"\\\n])*")
  | (?P<s2>'(?:\\.|[^'\\\n])*')
"""
_RE_BY_LANG: dict[str, re.Pattern[str]] = {
    "c": re.compile(_COMMON + _STR_C, re.S | re.X),
    "cpp": re.compile(_COMMON + r"""| (?P<raw>R"(?P<d>[^()\s]{0,16})\(.*?\)(?P=d)")""" + _STR_C, re.S | re.X),
    "java": re.compile(_COMMON + r'| (?P<tb>"""(?:\\.|[^\\])*?""")' + _STR_C, re.S | re.X),
    "csharp": re.compile(
        _COMMON + r'| (?P<tb>"""(?:\\.|[^\\])*?""") | (?P<vb>@"(?:""|[^"])*")' + _STR_C, re.S | re.X
    ),
    "javascript": re.compile(_COMMON + r"| (?P<tpl>`(?:\\.|[^`\\])*`)" + _STR_C, re.S | re.X),
    "typescript": re.compile(_COMMON + r"| (?P<tpl>`(?:\\.|[^`\\])*`)" + _STR_C, re.S | re.X),
    "sql": re.compile(r"(?P<lc>--[^\n]*) | (?P<bc>/\*.*?\*/) | (?P<s2>'(?:''|[^'])*')", re.S | re.X),
}


def _blank(text: str) -> str:
    return re.sub(r"[^\n]", " ", text)


def blank_source(text: str, lang: str) -> tuple[str, str]:
    """Return (no_comments, code). `no_comments` keeps strings (needed for import paths);
    `code` additionally blanks string interiors. Both preserve offsets and newlines."""
    rx = _RE_BY_LANG[lang]

    def no_comments(m: re.Match[str]) -> str:
        return _blank(m.group(0)) if m.lastgroup in {"lc", "bc"} else m.group(0)

    def code(m: re.Match[str]) -> str:
        g = m.group(0)
        if m.lastgroup in {"lc", "bc"}:
            return _blank(g)
        return g[0] + _blank(g[1:-1]) + g[-1] if len(g) >= 2 else g

    nc = rx.sub(no_comments, text)
    return nc, rx.sub(code, text)


# --------------------------------------------------------------------------- #
# 2. Shared helpers
# --------------------------------------------------------------------------- #
class _Src:
    """Offset ↔ line lookup, brace pairing and brace depth over blanked code."""

    def __init__(self, text: str, code: str) -> None:
        self.text, self.code = text, code
        self.nl = [i for i, ch in enumerate(text) if ch == "\n"]
        self.match: dict[int, int] = {}
        self._bpos: list[int] = []
        self._bdepth: list[int] = []
        stack: list[int] = []
        for i, ch in enumerate(code):
            if ch == "{":
                stack.append(i)
                self._bpos.append(i)
                self._bdepth.append(len(stack))
            elif ch == "}":
                if stack:
                    self.match[stack.pop()] = i
                self._bpos.append(i)
                self._bdepth.append(len(stack))

    def line(self, pos: int) -> int:
        return bisect_right(self.nl, pos - 1) + 1 if pos else 1

    def depth(self, pos: int) -> int:
        k = bisect_right(self._bpos, pos) - 1
        return self._bdepth[k] if k >= 0 else 0

    def end_of(self, open_brace: int) -> int:
        return self.match.get(open_brace, len(self.code) - 1)


_DECISION = re.compile(
    r"\b(?:if|for|foreach|while|case|catch|when)\b|&&|\|\||(?<=\s)\?(?=\s)|\?\?(?!=)", re.M
)
_NOT_FUNC = frozenset({
    "if", "for", "foreach", "while", "switch", "catch", "using", "lock", "return", "new", "else", "do",
    "try", "finally", "sizeof", "typeof", "fixed", "when", "synchronized", "function", "await", "throw",
    "super", "this", "delete", "defined", "elseif", "unless", "from", "select", "in", "of", "with",
})


def _complexity(code: str) -> int:
    return 1 + len(_DECISION.findall(code))


def _imp(module: str, lineno: int, scope: str, kind: str, *, system: bool = False, names: tuple = ()) -> ImportRef:
    return ImportRef(
        module=module, level=0, names=names, asname=None, is_from=False, lineno=lineno,
        scope=scope, kind=kind, system=system,  # type: ignore[arg-type]
    )


def _functions_by_regex(src: _Src, rx: re.Pattern[str], name_group: int = 1, *, params_group: Optional[int] = 2,
                        class_spans: Optional[list[tuple[int, int, str]]] = None) -> list[FunctionInfo]:
    """Find `name(args) ... {` declarations and measure each body."""
    out: list[FunctionInfo] = []
    seen: set[int] = set()
    for m in rx.finditer(src.code):
        name = m.group(name_group)
        if name in _NOT_FUNC:
            continue
        brace = m.end() - 1
        if src.code[brace] != "{" or brace in seen or brace not in src.match:
            continue
        seen.add(brace)
        end = src.end_of(brace)
        args = (m.group(params_group) or "").strip() if params_group else ""
        owner = ""
        if class_spans:
            owner = next((n for s, e, n in class_spans if s < m.start() < e), "")
        out.append(FunctionInfo(
            name=name, qualname=f"{owner}.{name}" if owner else name,
            lineno=src.line(m.start(name_group)), end_lineno=src.line(end),
            is_async=bool(re.search(r"\basync\b", src.code[max(0, m.start() - 12):m.start() + 1])),
            is_method=bool(owner), arg_count=0 if not args else args.count(",") + 1,
            complexity=_complexity(src.code[brace:end + 1]),
        ))
    return out


def _classes_by_regex(src: _Src, rx: re.Pattern[str], kind_of: Callable[[re.Match[str]], str]) -> tuple[list[ClassInfo], list[tuple[int, int, str]]]:
    classes: list[ClassInfo] = []
    spans: list[tuple[int, int, str]] = []
    for m in rx.finditer(src.code):
        brace = m.end() - 1
        if src.code[brace] != "{" or brace not in src.match:
            continue
        end = src.end_of(brace)
        raw_bases = " ".join(g for g in m.groups()[2:] if g)
        bases = [b.strip().split("<")[0] for b in re.split(r"[,\s]+(?:public|private|protected|virtual)?\s*", raw_bases) if b.strip() and b.strip() not in {"public", "private", "protected", "virtual", "implements", "extends"}]
        classes.append(ClassInfo(
            name=m.group(2), qualname=m.group(2), lineno=src.line(m.start(2)), end_lineno=src.line(end),
            bases=[b for b in bases if re.fullmatch(r"[\w.]+", b)], kind=kind_of(m),
        ))
        spans.append((brace, end, m.group(2)))
    return classes, spans


def _attach_methods(classes: list[ClassInfo], funcs: list[FunctionInfo]) -> None:
    by_name = {c.name: c for c in classes}
    for f in funcs:
        if f.is_method:
            owner = f.qualname.rpartition(".")[0].split(".")[-1]
            if owner in by_name:
                by_name[owner].methods.append(f.name)


# --------------------------------------------------------------------------- #
# 3. Language analyzers (each returns a ParsedModule)
# --------------------------------------------------------------------------- #
_CLASS_JAVA = re.compile(
    r"\b(class|interface|enum|record|@interface)\s+(\w+)(?:\s*<[^{;]*?>)?(?:\s*\([^)]*\))?"
    r"(?:\s+extends\s+([\w.<>,\s]+?))?(?:\s+implements\s+([\w.<>,\s]+?))?(?:\s+permits\s+[\w.,\s]+?)?\s*\{"
)
_CLASS_CS = re.compile(r"\b(class|interface|struct|record|enum)\s+(\w+)(?:\s*<[^{;:]*?>)?(?:\s*\([^)]*\))?(?:\s*:\s*([\w.<>,\s]+?))?(?:\s+where\s[^{;]*?)?\s*\{")
_CLASS_CPP = re.compile(r"\b(class|struct)\s+(\w+)(?:\s+final)?(?:\s*:\s*([\w:<>,\s]+?))?\s*\{")
_CLASS_JS = re.compile(r"\b(class|interface)\s+(\w+)(?:\s*<[^{]*?>)?(?:\s+extends\s+([\w.<>,\s]+?))?(?:\s+implements\s+([\w.<>,\s]+?))?\s*\{")

_FUNC_JAVA = re.compile(r"\b(\w+)\s*\(([^(){};]*)\)\s*(?:throws\s+[\w.,\s]+)?\{")
_FUNC_CS = re.compile(r"\b(\w+)\s*(?:<[^()]*?>)?\s*\(([^(){};]*)\)\s*(?:where\s[^{;]*?)?\{")
_FUNC_C = re.compile(r"\b(\w+)\s*\(([^(){};]*)\)\s*(?:const|noexcept|override|final|\s)*\{")
_FUNC_JS = [
    re.compile(r"\bfunction\s*\*?\s*(\w+)\s*(?:<[^()]*?>)?\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s*(?::\s*[^{;=]+?)?\s*\{"),
    re.compile(r"\b(?:const|let|var)\s+(\w+)\s*(?::[^=]+?)?=\s*(?:async\s*)?(?:<[^>]*>\s*)?\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s*(?::\s*[^=>{]+?)?=>\s*\{"),
    re.compile(r"^[ \t]*(?:(?:public|private|protected|static|async|get|set|readonly|override|abstract)\s+)*(\w+)\s*(?:<[^()]*?>)?\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s*(?::\s*[^{;=]+?)?\s*\{", re.M),
]


def _entry(code: str, patterns: list[str]) -> bool:
    return any(re.search(p, code) for p in patterns)


def _parse_java(src: _Src, nc: str, mod: ParsedModule) -> None:
    for m in re.finditer(r"^[ \t]*import\s+(static\s+)?([\w.]+?)(\.\*)?\s*;", nc, re.M):
        fqn = m.group(2)
        if m.group(1) and not m.group(3):
            fqn = fqn.rpartition(".")[0] or fqn  # static member -> owning class
        mod.imports.append(_imp(fqn, src.line(m.start()), "module", "symbol", names=("*",) if m.group(3) else ()))
    pkg = re.search(r"^[ \t]*package\s+([\w.]+)\s*;", src.code, re.M)
    classes, spans = _classes_by_regex(src, _CLASS_JAVA, lambda m: m.group(1))
    funcs = _functions_by_regex(src, _FUNC_JAVA, class_spans=spans)
    _attach_methods(classes, funcs)
    mod.classes, mod.functions = classes, funcs
    top = [c.name for c, (s, _, _) in zip(classes, spans) if src.depth(s) == 1]
    mod.provides = [f"{pkg.group(1)}.{n}" if pkg else n for n in top]
    mod.has_main_guard = _entry(src.code, [r"\bstatic\s+void\s+main\s*\("])


def _parse_csharp(src: _Src, nc: str, mod: ParsedModule) -> None:
    for m in re.finditer(r"^[ \t]*(?:global\s+)?using\s+(static\s+)?(?:\w+\s*=\s*)?([\w.]+)\s*;", nc, re.M):
        mod.imports.append(_imp(m.group(2), src.line(m.start()), "module", "symbol"))
    mod.provides = [m.group(1) for m in re.finditer(r"\bnamespace\s+([\w.]+)", src.code)]
    classes, spans = _classes_by_regex(src, _CLASS_CS, lambda m: m.group(1))
    funcs = _functions_by_regex(src, _FUNC_CS, class_spans=spans)
    _attach_methods(classes, funcs)
    mod.classes, mod.functions = classes, funcs
    mod.has_main_guard = _entry(src.code, [r"\bstatic\s+(?:async\s+)?(?:void|int|Task(?:<int>)?)\s+Main\s*\("])


def _parse_c_like(src: _Src, nc: str, mod: ParsedModule, cpp: bool) -> None:
    for m in re.finditer(r'^[ \t]*#[ \t]*(?:include|import)[ \t]*([<"])([^>"\n]+)[>"]', nc, re.M):
        mod.imports.append(_imp(m.group(2).strip(), src.line(m.start()), "module", "path", system=m.group(1) == "<"))
    classes, spans = _classes_by_regex(src, _CLASS_CPP if cpp else re.compile(r"\b(struct)\s+(\w+)\s*\{"), lambda m: m.group(1))
    funcs = _functions_by_regex(src, _FUNC_C, class_spans=spans)
    for f in funcs:  # `Foo::bar` style out-of-line methods
        pre = src.code[max(0, src.nl[f.lineno - 2] if f.lineno > 1 else 0):]
        mm = re.match(r"\s*[\w\s:*&<>,]*?(\w+)::" + re.escape(f.name) + r"\s*\(", pre)
        if mm:
            f.qualname, f.is_method = f"{mm.group(1)}.{f.name}", True
    _attach_methods(classes, funcs)
    mod.classes, mod.functions = classes, funcs
    mod.has_main_guard = _entry(src.code, [r"\b(?:int|void)\s+(?:w?main|WinMain)\s*\("])


def _parse_js_like(src: _Src, nc: str, mod: ParsedModule, ts: bool) -> None:
    def scope_at(pos: int) -> str:
        return "module" if src.depth(pos) == 0 else "function"

    seen: set[tuple[str, int]] = set()

    def add(spec: str, pos: int, scope: str) -> None:
        key = (spec, pos)
        if spec and key not in seen:
            seen.add(key)
            mod.imports.append(_imp(spec, src.line(pos), scope, "path"))

    for m in re.finditer(r"\b(?:import|export)\s+(type\s+)?[^'\";]*?\bfrom\s*['\"]([^'\"\n]+)['\"]", nc):
        add(m.group(2), m.start(), "type_checking" if m.group(1) else "module")
    for m in re.finditer(r"\bimport\s*['\"]([^'\"\n]+)['\"]", nc):
        add(m.group(1), m.start(), "module")
    for m in re.finditer(r"\bimport\s+\w+\s*=\s*require\(\s*['\"]([^'\"\n]+)['\"]\s*\)", nc):
        add(m.group(1), m.start(), "module")
    for m in re.finditer(r"(?<![\w.$])require\s*\(\s*['\"]([^'\"\n]+)['\"]\s*\)", nc):
        add(m.group(1), m.start(), scope_at(m.start()))
    for m in re.finditer(r"(?<![\w.$])import\s*\(\s*['\"]([^'\"\n]+)['\"]\s*\)", nc):
        add(m.group(1), m.start(), "function")

    classes, spans = _classes_by_regex(src, _CLASS_JS, lambda m: m.group(1))
    funcs: list[FunctionInfo] = []
    used: set[int] = set()
    for rx in _FUNC_JS:
        for f in _functions_by_regex(src, rx, class_spans=spans):
            if f.lineno not in used or rx is not _FUNC_JS[2]:
                funcs.append(f)
                used.add(f.lineno)
    funcs.sort(key=lambda f: f.lineno)
    _attach_methods(classes, funcs)
    mod.classes, mod.functions = classes, funcs
    mod.has_main_guard = bool(re.search(r"require\.main\s*===?\s*module", src.code)) or src.text.startswith("#!")


_SQL_OBJ = r"(?:\[?[\w$]+\]?|`[^`]+`|\"[^\"]+\")(?:\s*\.\s*(?:\[?[\w$]+\]?|`[^`]+`|\"[^\"]+\"))*"


def _sql_name(raw: str) -> str:
    return re.sub(r"\s+", "", re.sub(r"[`\"\[\]]", "", raw)).lower()


def _parse_sql(src: _Src, nc: str, mod: ParsedModule) -> None:
    text = src.code  # strings already blanked; comments removed
    create = re.compile(
        r"\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:(?:GLOBAL|LOCAL)\s+)?(?:TEMP(?:ORARY)?\s+|MATERIALIZED\s+|UNIQUE\s+)?"
        r"(TABLE|VIEW|FUNCTION|PROCEDURE|PROC|TYPE|SEQUENCE|TRIGGER)\s+(?:IF\s+NOT\s+EXISTS\s+)?(" + _SQL_OBJ + ")", re.I)
    defined: list[tuple[int, str, str]] = []
    for m in create.finditer(text):
        kind, name = m.group(1).upper(), _sql_name(m.group(2))
        defined.append((m.start(), kind, name))
        mod.provides.append(name)
        if "." in name:
            mod.provides.append(name.rpartition(".")[2])
    ctes = {_sql_name(m.group(1)) for m in re.finditer(r"(?:\bWITH|,)\s+(\w+)\s+AS\s*\(", text, re.I)}
    own = set(mod.provides)
    for i, (pos, kind, name) in enumerate(defined):
        end = defined[i + 1][0] if i + 1 < len(defined) else len(text)
        if kind in {"TABLE", "VIEW", "TYPE", "SEQUENCE"}:
            mod.classes.append(ClassInfo(name=name, qualname=name, lineno=src.line(pos), end_lineno=src.line(end), kind=kind.lower()))
        if kind in {"FUNCTION", "PROCEDURE", "PROC", "TRIGGER"}:
            body = text[pos:end]
            mod.functions.append(FunctionInfo(
                name=name, qualname=name, lineno=src.line(pos), end_lineno=src.line(end), is_async=False,
                is_method=False, arg_count=0,
                complexity=1 + len(re.findall(r"\b(?:CASE|WHEN|IF|ELSIF|ELSEIF|WHILE|LOOP|FOR|AND|OR|JOIN|UNION)\b", body, re.I)),
            ))
    refs = re.compile(
        r"\b(?:REFERENCES|FROM|JOIN|INSERT\s+INTO|UPDATE|DELETE\s+FROM|ALTER\s+TABLE|TRUNCATE\s+TABLE|EXEC(?:UTE)?|CALL)\s+(?:ONLY\s+)?(" + _SQL_OBJ + ")", re.I)
    for m in refs.finditer(text):
        name = _sql_name(m.group(1))
        if name and name not in own and name not in ctes and not name[0].isdigit():
            mod.imports.append(_imp(name, src.line(m.start()), "module", "sql"))
    for m in re.finditer(r"^[ \t]*(?:\\i|\\ir|:r|source|@@?)[ \t]+['\"]?([^\s'\";]+\.sql)", nc, re.M | re.I):
        mod.imports.append(_imp(m.group(1), src.line(m.start()), "module", "path"))
    mod.complexity = 1 + len(re.findall(r"\b(?:CASE|WHEN|IF|ELSIF|ELSEIF|WHILE|LOOP|FOR|AND|OR|JOIN|UNION)\b", text, re.I))


# --------------------------------------------------------------------------- #
# 4. Entry point
# --------------------------------------------------------------------------- #
def parse_foreign(source: bytes, rel_path: str, lang: str) -> ParsedModule:
    """Parse one non-Python source file. Never raises."""
    mod = ParsedModule(rel_path=rel_path, language=lang, loc=source.count(b"\n") + 1 if source else 0)
    try:
        text = source.decode("utf-8-sig", errors="replace")
        nc, code = blank_source(text, lang)
        src = _Src(text, code)
        if lang == "java":
            _parse_java(src, nc, mod)
        elif lang == "csharp":
            _parse_csharp(src, nc, mod)
        elif lang in {"c", "cpp"}:
            _parse_c_like(src, nc, mod, cpp=lang == "cpp")
        elif lang in {"javascript", "typescript"}:
            _parse_js_like(src, nc, mod, ts=lang == "typescript")
        elif lang == "sql":
            _parse_sql(src, nc, mod)
        if lang != "sql":
            mod.complexity = _complexity(code)
    except (RecursionError, MemoryError, re.error) as exc:
        mod.error = f"{type(exc).__name__}: {exc}"
    return mod
