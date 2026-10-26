"""Static, non-executing source analysis.

Python uses the stdlib `ast` module; C, C++, Java, JavaScript, TypeScript, C# and SQL go through
`polyglot`. Source is never compiled, executed or imported, so analyzing untrusted repositories
cannot run their code.
"""
from __future__ import annotations

import ast
import logging
import os
from pathlib import Path
from typing import Iterable, Optional

from parser_models import CallRef, ClassInfo, FunctionInfo, ImportRef, ImportScope, ParsedModule  # noqa: F401

logger = logging.getLogger(__name__)

MAX_SOURCE_BYTES = 1_000_000
MAX_SOURCE_FILES = 5_000
MAX_PY_FILES = MAX_SOURCE_FILES  # backwards-compatible alias
SKIP_DIRS = frozenset({
    ".git", ".hg", ".svn", "__pycache__", "node_modules", "venv", ".venv", "env",
    ".tox", ".nox", "site-packages", "build", "dist", ".mypy_cache", ".pytest_cache",
    ".ruff_cache", ".eggs", "bin", "obj", "target", "vendor", ".next", ".nuxt", "coverage", ".gradle", ".idea", ".vs",
})

class ParseLimitError(Exception):
    """Raised when a repository exceeds configured analysis limits."""


# --------------------------------------------------------------------------- #
# Language registry
# --------------------------------------------------------------------------- #
LANGUAGES: dict[str, dict] = {
    "python": {"label": "Python", "exts": (".py",)},
    "javascript": {"label": "JavaScript", "exts": (".js", ".jsx", ".mjs", ".cjs")},
    "typescript": {"label": "TypeScript", "exts": (".ts", ".tsx", ".mts", ".cts")},
    "java": {"label": "Java", "exts": (".java",)},
    "c": {"label": "C", "exts": (".c", ".h")},
    "cpp": {"label": "C++", "exts": (".cpp", ".cc", ".cxx", ".hpp", ".hh", ".hxx", ".h")},
    "csharp": {"label": "C#", "exts": (".cs",)},
    "sql": {"label": "SQL", "exts": (".sql",)},
}
_CPP_ONLY = (".cpp", ".cc", ".cxx", ".hpp", ".hh", ".hxx")
_DECL_SUFFIXES = (".d.ts",)  # TypeScript declaration files carry no runtime structure


def normalize_languages(raw: Optional[Iterable[str] | str]) -> Optional[frozenset[str]]:
    """None / "auto" / empty -> auto-detect (None). Otherwise a validated set of language ids."""
    if raw is None:
        return None
    items = [p.strip().lower() for p in (raw.split(",") if isinstance(raw, str) else raw) if p and p.strip()]
    aliases = {"js": "javascript", "ts": "typescript", "c++": "cpp", "cs": "csharp", "c#": "csharp", "py": "python"}
    items = [aliases.get(i, i) for i in items]
    if not items or "auto" in items:
        return None
    bad = [i for i in items if i not in LANGUAGES]
    if bad:
        raise ValueError(f"Unsupported language(s): {', '.join(bad)}. Supported: auto, {', '.join(LANGUAGES)}.")
    return frozenset(items)


def source_extensions(languages: Optional[frozenset[str]] = None) -> frozenset[str]:
    """File suffixes worth extracting for the requested languages (all when auto-detecting)."""
    return frozenset(e for k, v in LANGUAGES.items() if languages is None or k in languages for e in v["exts"])


def language_for(filename: str, languages: Optional[frozenset[str]] = None, header_lang: str = "c") -> Optional[str]:
    """Map a file name to a language id, honouring the selected set (None = auto)."""
    name = filename.lower()
    if name.endswith(_DECL_SUFFIXES):
        return None
    ext = os.path.splitext(name)[1]
    if ext == ".h":
        pick = header_lang
        if languages is not None:
            pick = "c" if "c" in languages and "cpp" not in languages else "cpp" if "cpp" in languages and "c" not in languages else header_lang
            if pick not in languages:
                return None
        return pick
    for lang, meta in LANGUAGES.items():
        if ext in meta["exts"] and (languages is None or lang in languages):
            return lang
    return None


def dotted_name(node: ast.AST) -> Optional[str]:
    """Resolve `a.b.c` style Name/Attribute chains; None for dynamic expressions."""
    parts: list[str] = []
    while isinstance(node, ast.Attribute):
        parts.append(node.attr)
        node = node.value
    if isinstance(node, ast.Name):
        parts.append(node.id)
        return ".".join(reversed(parts))
    return None


def _is_type_checking_test(test: ast.expr) -> bool:
    return (isinstance(test, ast.Name) and test.id == "TYPE_CHECKING") or (
        isinstance(test, ast.Attribute) and test.attr == "TYPE_CHECKING"
    )


def _is_main_guard(test: ast.expr) -> bool:
    if not isinstance(test, ast.Compare) or len(test.ops) != 1 or len(test.comparators) != 1:
        return False
    if not isinstance(test.ops[0], ast.Eq):
        return False
    sides = (test.left, test.comparators[0])
    has_name = any(isinstance(s, ast.Name) and s.id == "__name__" for s in sides)
    has_main = any(isinstance(s, ast.Constant) and s.value == "__main__" for s in sides)
    return has_name and has_main


class ModuleVisitor(ast.NodeVisitor):
    """Collects imports, classes, functions, call references, and cyclomatic complexity."""

    def __init__(self) -> None:
        self.imports: list[ImportRef] = []
        self.classes: list[ClassInfo] = []
        self.functions: list[FunctionInfo] = []
        self.calls: list[CallRef] = []
        self.has_main_guard = False
        self._scope: list[tuple[str, str]] = []  # (kind, name)
        self._func_stack: list[FunctionInfo] = []
        self._class_stack: list[ClassInfo] = []
        self._type_checking_depth = 0
        self._module_decisions = 0

    # -- helpers ----------------------------------------------------------- #
    @property
    def total_complexity(self) -> int:
        return 1 + self._module_decisions + sum(f.complexity - 1 for f in self.functions)

    def _qualname(self, name: str) -> str:
        return ".".join([n for _, n in self._scope] + [name])

    def _caller(self) -> str:
        return self._func_stack[-1].qualname if self._func_stack else "<module>"

    def _bump(self, amount: int = 1) -> None:
        if self._func_stack:
            self._func_stack[-1].complexity += amount
        else:
            self._module_decisions += amount

    def _import_scope(self) -> ImportScope:
        if self._type_checking_depth > 0:
            return "type_checking"
        return "function" if self._func_stack else "module"

    def _visit_all(self, nodes: list[ast.AST]) -> None:
        for n in nodes:
            self.visit(n)

    # -- imports ----------------------------------------------------------- #
    def visit_Import(self, node: ast.Import) -> None:
        scope = self._import_scope()
        for alias in node.names:
            self.imports.append(ImportRef(
                module=alias.name, level=0, names=(), asname=alias.asname,
                is_from=False, lineno=node.lineno, scope=scope,
            ))

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        self.imports.append(ImportRef(
            module=node.module or "", level=node.level or 0,
            names=tuple((a.name, a.asname) for a in node.names),
            asname=None, is_from=True, lineno=node.lineno, scope=self._import_scope(),
        ))

    # -- definitions ------------------------------------------------------- #
    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        self._visit_all(node.decorator_list)
        self._visit_all(node.bases)
        self._visit_all([k.value for k in node.keywords])

        info = ClassInfo(
            name=node.name,
            qualname=self._qualname(node.name),
            lineno=node.lineno,
            end_lineno=getattr(node, "end_lineno", None) or node.lineno,
            bases=[b for b in (dotted_name(x) for x in node.bases) if b],
            decorators=[d for d in (dotted_name(x.func if isinstance(x, ast.Call) else x)
                                    for x in node.decorator_list) if d],
        )
        self.classes.append(info)
        self._scope.append(("class", node.name))
        self._class_stack.append(info)
        try:
            self._visit_all(node.body)
        finally:
            self._class_stack.pop()
            self._scope.pop()

    def _visit_function(self, node: ast.FunctionDef | ast.AsyncFunctionDef, is_async: bool) -> None:
        self._visit_all(node.decorator_list)
        args = node.args
        self._visit_all(list(args.defaults) + [d for d in args.kw_defaults if d is not None])

        is_method = bool(self._scope) and self._scope[-1][0] == "class"
        info = FunctionInfo(
            name=node.name,
            qualname=self._qualname(node.name),
            lineno=node.lineno,
            end_lineno=getattr(node, "end_lineno", None) or node.lineno,
            is_async=is_async,
            is_method=is_method,
            arg_count=len(args.posonlyargs) + len(args.args) + len(args.kwonlyargs)
            + (1 if args.vararg else 0) + (1 if args.kwarg else 0),
            decorators=[d for d in (dotted_name(x.func if isinstance(x, ast.Call) else x)
                                    for x in node.decorator_list) if d],
        )
        self.functions.append(info)
        if is_method and self._class_stack:
            self._class_stack[-1].methods.append(node.name)

        self._scope.append(("function", node.name))
        self._func_stack.append(info)
        try:
            self._visit_all(node.body)
        finally:
            self._func_stack.pop()
            self._scope.pop()

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        self._visit_function(node, False)

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        self._visit_function(node, True)

    # -- calls ------------------------------------------------------------- #
    def visit_Call(self, node: ast.Call) -> None:
        name = dotted_name(node.func)
        if name:
            self.calls.append(CallRef(name=name, lineno=node.lineno, caller=self._caller()))
            # Statically-literal dynamic imports: importlib.import_module("pkg.mod")
            if (name.endswith("import_module") or name == "__import__") and node.args:
                first = node.args[0]
                if isinstance(first, ast.Constant) and isinstance(first.value, str) and first.value:
                    self.imports.append(ImportRef(
                        module=first.value, level=0, names=(), asname=None,
                        is_from=False, lineno=node.lineno, scope="function",
                    ))
        self.generic_visit(node)

    # -- control flow / complexity ---------------------------------------- #
    def visit_If(self, node: ast.If) -> None:
        if _is_type_checking_test(node.test):
            self._type_checking_depth += 1
            try:
                self._visit_all(node.body)
            finally:
                self._type_checking_depth -= 1
            self._visit_all(node.orelse)
            return
        if _is_main_guard(node.test):
            self.has_main_guard = True
        else:
            self._bump()
        self.generic_visit(node)

    def visit_For(self, node: ast.For) -> None:
        self._bump()
        self.generic_visit(node)

    def visit_AsyncFor(self, node: ast.AsyncFor) -> None:
        self._bump()
        self.generic_visit(node)

    def visit_While(self, node: ast.While) -> None:
        self._bump()
        self.generic_visit(node)

    def visit_ExceptHandler(self, node: ast.ExceptHandler) -> None:
        self._bump()
        self.generic_visit(node)

    def visit_IfExp(self, node: ast.IfExp) -> None:
        self._bump()
        self.generic_visit(node)

    def visit_BoolOp(self, node: ast.BoolOp) -> None:
        self._bump(max(0, len(node.values) - 1))
        self.generic_visit(node)

    def visit_comprehension(self, node: ast.comprehension) -> None:
        self._bump(1 + len(node.ifs))
        self.generic_visit(node)

    def visit_match_case(self, node: ast.AST) -> None:  # py3.10+ structural matching
        self._bump()
        self.generic_visit(node)


def parse_source(source: bytes, rel_path: str) -> ParsedModule:
    """Parse raw bytes (honouring PEP 263 encoding cookies). Never raises."""
    module = ParsedModule(rel_path=rel_path, loc=source.count(b"\n") + 1 if source else 0)
    try:
        tree = ast.parse(source, filename=rel_path, type_comments=False)
    except SyntaxError as exc:
        module.error = f"SyntaxError: {exc.msg} (line {exc.lineno})"
        return module
    except (ValueError, RecursionError, MemoryError) as exc:
        module.error = f"{type(exc).__name__}: {exc}"
        return module

    visitor = ModuleVisitor()
    try:
        visitor.visit(tree)
    except RecursionError:
        module.error = "RecursionError: source nesting too deep"
        return module

    module.imports = visitor.imports
    module.classes = visitor.classes
    module.functions = visitor.functions
    module.calls = visitor.calls
    module.has_main_guard = visitor.has_main_guard
    module.complexity = visitor.total_complexity
    return module


def parse_file(path: Path, rel_path: str, lang: str = "python") -> ParsedModule:
    try:
        size = path.stat().st_size
        if size > MAX_SOURCE_BYTES:
            return ParsedModule(rel_path=rel_path, language=lang, error="File exceeds size limit")
        data = path.read_bytes()
    except OSError as exc:
        return ParsedModule(rel_path=rel_path, language=lang, error=f"OSError: {exc}")
    if lang == "python":
        return parse_source(data, rel_path)
    from polyglot import parse_foreign  # local import keeps Python-only use dependency-light

    return parse_foreign(data, rel_path, lang)


def _iter_source_files(root: Path):
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS and not d.endswith(".egg-info"))
        for fname in sorted(filenames):
            full = Path(dirpath) / fname
            if not full.is_symlink():
                yield full


def detect_languages(root: Path) -> dict[str, int]:
    """Count recognised source files per language (used for auto-detect)."""
    counts: dict[str, int] = {}
    files = [p for p in _iter_source_files(root)]
    has_cpp = any(p.suffix.lower() in _CPP_ONLY for p in files)
    has_c = any(p.suffix.lower() == ".c" for p in files)
    header = "cpp" if has_cpp and not has_c else "c"
    for p in files:
        lang = language_for(p.name, None, header)
        if lang:
            counts[lang] = counts.get(lang, 0) + 1
    return dict(sorted(counts.items(), key=lambda kv: -kv[1]))


def parse_repository(root: Path, languages: Optional[frozenset[str]] = None) -> list[ParsedModule]:
    """Walk a repository checkout and parse every recognised source file (no symlink following).

    `languages=None` auto-detects: every supported language present is analysed together.
    """
    files = list(_iter_source_files(root))
    has_cpp = any(p.suffix.lower() in _CPP_ONLY for p in files)
    has_c = any(p.suffix.lower() == ".c" for p in files)
    header = "cpp" if has_cpp and not has_c else "c"
    modules: list[ParsedModule] = []
    for full in files:
        lang = language_for(full.name, languages, header)
        if not lang:
            continue
        if len(modules) >= MAX_SOURCE_FILES:
            raise ParseLimitError(f"Repository exceeds {MAX_SOURCE_FILES} source files.")
        modules.append(parse_file(full, full.relative_to(root).as_posix(), lang))
    return modules
