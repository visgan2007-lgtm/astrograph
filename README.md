# Astrograph

Static analysis for Python repositories: ingest a public GitHub repo (or a zip), parse every `.py`
file with the stdlib `ast` module (code is never executed), and explore the module dependency graph,
circular imports, complexity, and likely entry points.

## Run

Backend (Python 3.11+):

    cd backend
    python -m venv .venv && source .venv/bin/activate
    pip install -r requirements.txt
    uvicorn main:app --port 8000

Frontend (Node 18+):

    cd frontend
    npm install
    npm run dev          # http://localhost:5173, proxies /api to :8000

## API

`POST /api/analyze` (multipart form): exactly one of `repo_url` (public `https://github.com/owner/repo[/tree/ref]`)
or `archive` (.zip). Returns `{nodes, edges, cycles, entry_points, stats, repository}`.

## Safety

Fixed download host with redirects off; size/entry caps; zip-slip, symlink, encrypted-entry and
decompression-bomb checks; only `.py` files extracted; temp dir removed after each request.

Env: `ASTROGRAPH_CORS_ORIGINS`, `ASTROGRAPH_MAX_CONCURRENCY`.
