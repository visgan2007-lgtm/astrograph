"""Shared parse-result dataclasses (kept separate so every language parser can import them)."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal, Optional

ImportScope = Literal["module", "function", "type_checking"]
ImportKind = Literal["python", "path", "symbol", "sql"]


@dataclass(slots=True)
class ImportRef:
    module: str                                   # "" for `from . import x`
    level: int                                    # leading dots for relative imports
    names: tuple[tuple[str, Optional[str]], ...]  # (name, asname) for from-imports
    asname: Optional[str]                         # alias for plain `import a.b as x`
    is_from: bool
    lineno: int
    scope: ImportScope
    kind: ImportKind = "python"                  # how the specifier is resolved (see graph_engine)
    system: bool = False                          # `#include <...>` style system import


@dataclass(slots=True)
class FunctionInfo:
    name: str
    qualname: str
    lineno: int
    end_lineno: int
    is_async: bool
    is_method: bool
    arg_count: int
    decorators: list[str] = field(default_factory=list)
    complexity: int = 1


@dataclass(slots=True)
class ClassInfo:
    name: str
    qualname: str
    lineno: int
    end_lineno: int
    bases: list[str] = field(default_factory=list)
    decorators: list[str] = field(default_factory=list)
    methods: list[str] = field(default_factory=list)
    kind: str = "class"                           # class | interface | enum | struct | table | view ...


@dataclass(slots=True)
class CallRef:
    name: str      # dotted callee, e.g. "utils.helpers.slugify" or "self.run"
    lineno: int
    caller: str    # qualname of enclosing function, or "<module>"


@dataclass(slots=True)
class ParsedModule:
    rel_path: str
    loc: int = 0
    imports: list[ImportRef] = field(default_factory=list)
    classes: list[ClassInfo] = field(default_factory=list)
    functions: list[FunctionInfo] = field(default_factory=list)
    calls: list[CallRef] = field(default_factory=list)
    has_main_guard: bool = False
    complexity: int = 1
    error: Optional[str] = None
    language: str = "python"
    provides: list[str] = field(default_factory=list)   # symbols/namespaces/objects this file defines
