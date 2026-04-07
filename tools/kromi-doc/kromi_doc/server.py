"""FastAPI server exposing kromi-doc operations over HTTP.

Optional — only available with `pip install kromi-doc[server]`.

Example usage:

    kromi-doc serve --port 8765
    curl -X POST http://localhost:8765/sync -d '{"only":["stores"]}' -H "Content-Type: application/json"
    curl 'http://localhost:8765/search?q=authentication&top_k=5'
    curl http://localhost:8765/health
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any

try:
    from fastapi import FastAPI, HTTPException, Query
    from pydantic import BaseModel
except ImportError as exc:
    raise RuntimeError(
        "FastAPI not installed. Run: pip install kromi-doc[server]"
    ) from exc

from kromi_doc.deps import DependencyGraph
from kromi_doc.embeddings import VaultIndex
from kromi_doc.obsidian import ObsidianClient
from kromi_doc.sync import SyncEngine
from kromi_doc.validate import VaultValidator


def _project_root() -> Path:
    if env := os.environ.get("KROMI_PROJECT_ROOT"):
        return Path(env)
    cwd = Path.cwd()
    for parent in [cwd, *cwd.parents]:
        if (parent / "src" / "store").exists():
            return parent
    return cwd


app = FastAPI(
    title="kromi-doc",
    description="Auto-sync engine + RAG search for the KROMI Obsidian vault",
    version="0.1.0",
)


class SyncRequest(BaseModel):
    only: list[str] | None = None
    full: bool = False
    dry_run: bool = False


class SearchResult(BaseModel):
    path: str
    score: float
    snippet: str


class HealthResponse(BaseModel):
    obsidian: bool
    project_root: str
    index_built: bool


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    client = ObsidianClient()
    root = _project_root()
    return HealthResponse(
        obsidian=client.ping(),
        project_root=str(root),
        index_built=(root / ".kromi-doc-index.json").exists(),
    )


@app.post("/sync")
def sync(req: SyncRequest) -> dict[str, Any]:
    client = ObsidianClient()
    if not client.ping():
        raise HTTPException(503, "Obsidian Local REST API not reachable")
    engine = SyncEngine(project_root=_project_root(), client=client, dry_run=req.dry_run)
    only = req.only or []
    if req.full or not only:
        only = ["stores", "hooks", "services", "components", "edge_functions", "database"]
    for cat in only:
        engine.sync_category(cat)
    return {
        "written": engine.stats.written,
        "skipped_unchanged": engine.stats.skipped_unchanged,
        "failed": engine.stats.failed,
        "by_category": engine.stats.by_category,
        "dry_run": req.dry_run,
    }


@app.get("/search", response_model=list[SearchResult])
def search(q: str = Query(...), top_k: int = Query(10)) -> list[SearchResult]:
    idx = VaultIndex(project_root=_project_root())
    if not idx.exists():
        raise HTTPException(503, "Index not built. POST /embed first.")
    return [
        SearchResult(path=p, score=s, snippet=sn)
        for p, s, sn in idx.search(q, top_k=top_k)
    ]


@app.post("/embed")
def embed(model: str = "tfidf") -> dict[str, Any]:
    client = ObsidianClient()
    if not client.ping():
        raise HTTPException(503, "Obsidian Local REST API not reachable")
    idx = VaultIndex(project_root=_project_root(), model=model)
    n = idx.build(client)
    return {"indexed": n, "model": model}


@app.post("/validate")
def validate() -> dict[str, Any]:
    client = ObsidianClient()
    if not client.ping():
        raise HTTPException(503, "Obsidian Local REST API not reachable")
    v = VaultValidator(client=client)
    report = v.run()
    return {
        "total_notes": report.total_notes,
        "broken_links": len(report.broken_links),
        "missing_frontmatter": len(report.missing_frontmatter),
        "orphans": len(report.orphans),
        "is_clean": report.is_clean(),
    }


@app.post("/deps")
def deps(category: str | None = None) -> dict[str, Any]:
    client = ObsidianClient()
    if not client.ping():
        raise HTTPException(503, "Obsidian Local REST API not reachable")
    g = DependencyGraph(project_root=_project_root())
    n = g.publish(client, category=category)
    return {"published": n, "category": category}
