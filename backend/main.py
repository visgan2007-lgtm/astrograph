"""Astrograph API: repository ingestion, safe archive extraction, analysis pipeline.

Run:  uvicorn main:app --host 0.0.0.0 --port 8000
Deps: fastapi, uvicorn[standard], httpx, python-multipart  (Python 3.11+)
"""
from __future__ import annotations

import asyncio
import logging
import os
import re
import shutil
import stat
import tempfile
import zipfile
from pathlib import Path, PurePosixPath
from typing import Optional

import httpx
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from graph_engine import DependencyGraph
from parser import (
    LANGUAGES, MAX_SOURCE_BYTES, SKIP_DIRS, ParseLimitError, detect_languages, normalize_languages,
    parse_repository, source_extensions,
)
from pathfinder import build_tour
from snapshot_diff import SnapshotStore, diff_snapshots

logger = logging.getLogger("astrograph")

MAX_ARCHIVE_BYTES = 50 * 1024 * 1024        # compressed download / upload cap
MAX_EXTRACTED_BYTES = 200 * 1024 * 1024     # cumulative cap on extracted source
MAX_ARCHIVE_ENTRIES = 50_000
CHUNK = 64 * 1024

GITHUB_URL_RE = re.compile(
    r"^https://github\.com/"
    r"(?P<owner>[A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))/"
    r"(?P<repo>[A-Za-z0-9._-]{1,100}?)"
    r"(?:\.git)?"
    r"(?:/tree/(?P<ref>[A-Za-z0-9._/-]{1,200}))?/?$"
)

store = SnapshotStore()
_analysis_slots = asyncio.Semaphore(int(os.getenv("ASTROGRAPH_MAX_CONCURRENCY", "2")))

app = FastAPI(title="Astrograph", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("ASTROGRAPH_CORS_ORIGINS", "http://localhost:5173").split(","),
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


class ArchiveError(Exception):
    """Raised for malformed or malicious archives."""


# --------------------------------------------------------------------------- #
# Ingestion
# --------------------------------------------------------------------------- #
async def _download_github_archive(owner: str, repo: str, ref: str, dest: Path) -> None:
    # Host is fixed (codeload.github.com) and redirects are disabled: no SSRF surface.
    url = f"https://codeload.github.com/{owner}/{repo}/zip/{ref}"
    timeout = httpx.Timeout(30.0, connect=10.0)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
        async with client.stream("GET", url) as resp:
            if resp.status_code == 404:
                raise HTTPException(404, "Repository or ref not found (is it public?).")
            if resp.status_code != 200:
                raise HTTPException(502, f"GitHub responded with HTTP {resp.status_code}.")
            declared = resp.headers.get("content-length")
            if declared and declared.isdigit() and int(declared) > MAX_ARCHIVE_BYTES:
                raise HTTPException(413, "Repository archive exceeds the size limit.")
            total = 0
            with dest.open("wb") as fh:
                async for chunk in resp.aiter_bytes(CHUNK):
                    total += len(chunk)
                    if total > MAX_ARCHIVE_BYTES:
                        raise HTTPException(413, "Repository archive exceeds the size limit.")
                    fh.write(chunk)


async def _store_upload(upload: UploadFile, dest: Path) -> None:
    total = 0
    with dest.open("wb") as fh:
        while chunk := await upload.read(CHUNK):
            total += len(chunk)
            if total > MAX_ARCHIVE_BYTES:
                raise HTTPException(413, "Uploaded archive exceeds the size limit.")
            fh.write(chunk)


def safe_extract_zip(archive_path: Path, dest: Path, suffixes: Optional[frozenset[str]] = None) -> int:
    """Extract only regular source files (default: every supported language) from a zip, defending against zip-slip,
    symlinks, encrypted entries, and decompression bombs. Returns files written."""
    suffixes = suffixes or source_extensions()
    dest_root = dest.resolve()
    try:
        zf = zipfile.ZipFile(archive_path)
    except zipfile.BadZipFile as exc:
        raise ArchiveError("Not a valid zip archive.") from exc

    written_files = 0
    total_bytes = 0
    with zf:
        infos = zf.infolist()
        if len(infos) > MAX_ARCHIVE_ENTRIES:
            raise ArchiveError("Archive contains too many entries.")
        for info in infos:
            if info.is_dir():
                continue
            name = info.filename
            pure = PurePosixPath(name)
            if (
                pure.is_absolute()
                or ".." in pure.parts
                or "\\" in name
                or "\x00" in name
                or (len(name) > 1 and name[1] == ":")
            ):
                raise ArchiveError(f"Unsafe path in archive: {name!r}")
            if info.flag_bits & 0x1:
                raise ArchiveError("Encrypted archives are not supported.")
            if stat.S_ISLNK(info.external_attr >> 16):
                continue  # never materialise symlinks
            if pure.suffix.lower() not in suffixes or any(part in SKIP_DIRS for part in pure.parts[:-1]):
                continue
            if info.file_size > MAX_SOURCE_BYTES:
                continue

            target = (dest_root / pure).resolve()
            if not target.is_relative_to(dest_root):
                raise ArchiveError(f"Path traversal attempt: {name!r}")
            target.parent.mkdir(parents=True, exist_ok=True)

            copied = 0
            with zf.open(info) as src, target.open("wb") as out:
                while chunk := src.read(CHUNK):
                    copied += len(chunk)
                    if copied > MAX_SOURCE_BYTES:  # header lied about size
                        raise ArchiveError("Decompression bomb detected.")
                    out.write(chunk)
            total_bytes += copied
            if total_bytes > MAX_EXTRACTED_BYTES:
                raise ArchiveError("Extracted source exceeds the size limit.")
            written_files += 1
    return written_files


def _strip_wrapper_dir(root: Path) -> Path:
    """GitHub archives wrap content in `<repo>-<ref>/`; descend once if so."""
    entries = list(root.iterdir())
    if len(entries) == 1 and entries[0].is_dir() and not (entries[0] / "__init__.py").exists():
        return entries[0]
    return root


# --------------------------------------------------------------------------- #
# Pipeline
# --------------------------------------------------------------------------- #
def run_pipeline(root: Path, languages: Optional[frozenset[str]] = None) -> dict:
    detected = detect_languages(root)
    modules = parse_repository(root, languages)
    if not modules:
        wanted = ", ".join(LANGUAGES[l]["label"] for l in sorted(languages)) if languages else "supported"
        raise ArchiveError(f"No {wanted} source files were found in the repository.")
    payload = DependencyGraph(modules).to_payload()
    payload["language_mode"] = sorted(languages) if languages else "auto"
    payload["detected_languages"] = detected
    payload["tour"] = build_tour(payload)
    return payload


# --------------------------------------------------------------------------- #
# Routes
# --------------------------------------------------------------------------- #
@app.get("/api/languages")
async def languages_supported() -> list[dict]:
    return [{"id": k, "label": v["label"], "extensions": list(v["exts"])} for k, v in LANGUAGES.items()]


@app.get("/api/health")
async def health() -> dict:
    return {"status": "ok"}


@app.post("/api/analyze", response_model=None)
async def analyze(
    repo_url: Optional[str] = Form(None, description="Public GitHub repository URL"),
    archive: Optional[UploadFile] = File(None, description="Zip archive of a repository"),
    languages: Optional[str] = Form(None, description="Comma-separated language ids, or `auto`"),
) -> JSONResponse:
    has_upload = archive is not None and bool(archive.filename)
    has_url = bool(repo_url and repo_url.strip())
    if has_url == has_upload:
        raise HTTPException(400, "Provide exactly one of `repo_url` or `archive`.")

    try:
        selected = normalize_languages(languages)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    source_label: str
    workdir = Path(tempfile.mkdtemp(prefix="astrograph_"))
    try:
        archive_path = workdir / "repo.zip"
        extract_dir = workdir / "src"
        extract_dir.mkdir()

        if has_url:
            match = GITHUB_URL_RE.match(repo_url.strip())  # type: ignore[union-attr]
            if not match:
                raise HTTPException(400, "Only public https://github.com/<owner>/<repo> URLs are supported.")
            ref = match.group("ref") or "HEAD"
            if ".." in ref:
                raise HTTPException(400, "Invalid ref.")
            owner, repo = match.group("owner"), match.group("repo")
            source_label = f"{owner}/{repo}"
            await _download_github_archive(owner, repo, ref, archive_path)
        else:
            assert archive is not None
            source_label = archive.filename or "upload.zip"
            await _store_upload(archive, archive_path)

        try:
            extracted = await asyncio.to_thread(safe_extract_zip, archive_path, extract_dir, source_extensions(selected))
            if extracted == 0:
                raise ArchiveError("Archive contains no analyzable source files for the selected language(s).")
            root = _strip_wrapper_dir(extract_dir)
            async with _analysis_slots:
                payload = await asyncio.to_thread(run_pipeline, root, selected)
        except ArchiveError as exc:
            raise HTTPException(400, str(exc)) from exc
        except ParseLimitError as exc:
            raise HTTPException(413, str(exc)) from exc

        payload["repository"] = {"source": source_label, "files_extracted": extracted}
        payload["snapshot"] = await asyncio.to_thread(store.save, payload, source_label)
        return JSONResponse(payload)
    except HTTPException:
        raise
    except httpx.HTTPError as exc:
        logger.warning("Upstream fetch failed: %s", exc)
        raise HTTPException(502, "Failed to fetch repository from GitHub.") from exc
    except Exception:
        logger.exception("Analysis failed")
        raise HTTPException(500, "Internal analysis error.")
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


# --------------------------------------------------------------------------- #
# Snapshots and diff
# --------------------------------------------------------------------------- #
@app.get("/api/snapshots")
async def snapshots(source: Optional[str] = None) -> list[dict]:
    return await asyncio.to_thread(store.list, source)


@app.get("/api/diff")
async def diff(base: str, head: str) -> dict:
    """Compare two snapshots by revision id or content-hash prefix."""
    try:
        b, h = await asyncio.gather(asyncio.to_thread(store.get, base), asyncio.to_thread(store.get, head))
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc
    return await asyncio.to_thread(diff_snapshots, b, h)
