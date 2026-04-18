"""kromi-doc CLI entry point."""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from kromi_doc.obsidian import ObsidianClient


def _load_dotenv(project_root: Path) -> None:
    """Lightweight .env loader so the CLI works without python-dotenv."""
    env = project_root / ".env"
    if not env.exists():
        return
    for line in env.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


def _resolve_project_root() -> Path:
    """Find the KROMI project root from CWD or env."""
    if env := os.environ.get("KROMI_PROJECT_ROOT"):
        return Path(env)
    cwd = Path.cwd()
    for parent in [cwd, *cwd.parents]:
        if (parent / "src" / "store").exists():
            return parent
    return cwd


# ─── Subcommand handlers ────────────────────────────────────


def cmd_sync(args: argparse.Namespace) -> int:
    from kromi_doc.sync import SyncEngine

    client = ObsidianClient()
    if not client.ping():
        print("[!] Obsidian not reachable (API offline + vault not found on disk)", file=sys.stderr)
        return 1
    engine = SyncEngine(
        project_root=args.project_root,
        client=client,
        dry_run=args.dry_run,
    )
    only = args.only or []
    if args.full or not only:
        only = ["stores", "hooks", "services", "components", "edge_functions", "database"]
    for cat in only:
        engine.sync_category(cat)
    print(engine.summary())
    return 0


def cmd_search(args: argparse.Namespace) -> int:
    from kromi_doc.embeddings import VaultIndex

    idx = VaultIndex(project_root=args.project_root)
    if not idx.exists():
        print("[!] Index not found. Run: kromi-doc embed", file=sys.stderr)
        return 1
    results = idx.search(args.query, top_k=args.top_k)
    if not results:
        print("(no results)")
        return 0
    for rank, (path, score, snippet) in enumerate(results, 1):
        print(f"{rank}. [{score:.3f}] {path}")
        if snippet:
            print(f"   {snippet[:200]}")
    return 0


def cmd_embed(args: argparse.Namespace) -> int:
    from kromi_doc.embeddings import VaultIndex

    client = ObsidianClient()
    if not client.ping():
        print("[!] Obsidian not reachable (API offline + vault not found on disk)", file=sys.stderr)
        return 1
    idx = VaultIndex(project_root=args.project_root, model=args.model)
    n = idx.build(client)
    print(f"[OK] Indexed {n} notes ({args.model})")
    return 0


def cmd_validate(args: argparse.Namespace) -> int:
    from kromi_doc.validate import VaultValidator

    client = ObsidianClient()
    if not client.ping():
        print("[!] Obsidian not reachable (API offline + vault not found on disk)", file=sys.stderr)
        return 1
    v = VaultValidator(client=client, fix=args.fix)
    report = v.run()
    print(report.summary())
    return 0 if report.is_clean() else 2


def cmd_new(args: argparse.Namespace) -> int:
    from kromi_doc.new_note import create_from_template

    client = ObsidianClient()
    if not client.ping():
        print("[!] Obsidian not reachable (API offline + vault not found on disk)", file=sys.stderr)
        return 1
    ok = create_from_template(
        template_name=args.template,
        title=args.title,
        output_path=args.output,
        client=client,
        append=args.append,
        extra=dict(item.split("=", 1) for item in (args.set or [])),
    )
    return 0 if ok else 1


def cmd_deps(args: argparse.Namespace) -> int:
    from kromi_doc.deps import DependencyGraph

    client = ObsidianClient()
    if not client.ping():
        print("[!] Obsidian not reachable (API offline + vault not found on disk)", file=sys.stderr)
        return 1
    g = DependencyGraph(project_root=args.project_root)
    n = g.publish(client, category=args.category)
    print(f"[OK] Published {n} dependency graph note(s)")
    return 0


def cmd_serve(args: argparse.Namespace) -> int:
    try:
        import uvicorn

        from kromi_doc.server import app  # noqa: F401
    except ImportError:
        print("[!] FastAPI extras not installed. Run: pip install kromi-doc[server]", file=sys.stderr)
        return 1
    uvicorn.run("kromi_doc.server:app", host=args.host, port=args.port, reload=args.reload)
    return 0


def cmd_install_hooks(args: argparse.Namespace) -> int:
    from kromi_doc.hooks import install_hooks, hook_status

    n, messages = install_hooks(args.project_root, force=args.force)
    for m in messages:
        print(m)
    print(f"\n[OK] {n} hooks installed/updated.")
    print("\nCurrent status:")
    for line in hook_status(args.project_root):
        print(line)
    print("\nMake sure OBSIDIAN_API_KEY is in your .env file.")
    print("On every commit, kromi-doc sync --full will run automatically.")
    print("On every push, kromi-doc sync + deps + embed + validate will run.")
    return 0


def cmd_uninstall_hooks(args: argparse.Namespace) -> int:
    from kromi_doc.hooks import uninstall_hooks

    n, messages = uninstall_hooks(args.project_root)
    for m in messages:
        print(m)
    print(f"\n[OK] {n} hooks removed.")
    return 0


def cmd_hooks_status(args: argparse.Namespace) -> int:
    from kromi_doc.hooks import hook_status

    print("Git hook status:")
    for line in hook_status(args.project_root):
        print(line)
    return 0


def cmd_list(args: argparse.Namespace) -> int:
    client = ObsidianClient()
    if not client.ping():
        print("[!] Obsidian not reachable (API offline + vault not found on disk)", file=sys.stderr)
        return 1

    paths = client.walk("")
    matched: list[str] = []
    for p in paths:
        content = client.get(p) or ""
        # parse simple frontmatter
        if not content.startswith("---"):
            continue
        end = content.find("\n---", 3)
        if end == -1:
            continue
        front = content[3:end]
        if args.type and f"type: {args.type}" not in front:
            continue
        if args.tag and f"{args.tag}" not in front:
            continue
        matched.append(p)

    for p in sorted(matched):
        print(p)
    print(f"\n({len(matched)} notes)")
    return 0


# ─── Argparse setup ─────────────────────────────────────────


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="kromi-doc",
        description="Auto-sync engine + RAG search + CLI for the KROMI Obsidian vault",
    )
    p.add_argument("--project-root", type=Path, default=None, help="Override KROMI project root")
    sub = p.add_subparsers(dest="command", required=True)

    # sync
    s = sub.add_parser("sync", help="Re-generate vault notes from source code")
    s.add_argument("--full", action="store_true", help="Sync all categories")
    s.add_argument("--only", action="append", choices=["stores", "hooks", "services", "components", "edge_functions", "database"])
    s.add_argument("--dry-run", action="store_true", help="Don't write, just report")
    s.set_defaults(func=cmd_sync)

    # search
    s = sub.add_parser("search", help="Semantic search across vault notes")
    s.add_argument("query", help="Search query")
    s.add_argument("--top-k", type=int, default=10)
    s.set_defaults(func=cmd_search)

    # embed
    s = sub.add_parser("embed", help="Build the embeddings index")
    s.add_argument("--model", choices=["tfidf", "st"], default="tfidf", help="tfidf (fast, offline) or sentence-transformers")
    s.set_defaults(func=cmd_embed)

    # validate
    s = sub.add_parser("validate", help="Check wikilinks + frontmatter")
    s.add_argument("--fix", action="store_true", help="Auto-fix safe issues")
    s.set_defaults(func=cmd_validate)

    # new
    s = sub.add_parser("new", help="Create a new note from a template")
    s.add_argument("template", choices=["feature", "decision", "module", "service", "use_case"])
    s.add_argument("title")
    s.add_argument("--output", required=True)
    s.add_argument("--append", action="store_true", help="Append to existing note instead of replacing")
    s.add_argument("--set", action="append", help="Template variable (key=value)")
    s.set_defaults(func=cmd_new)

    # deps
    s = sub.add_parser("deps", help="Generate service dependency graph (Mermaid)")
    s.add_argument("--category", default=None, help="Only one category (e.g. bluetooth)")
    s.set_defaults(func=cmd_deps)

    # serve
    s = sub.add_parser("serve", help="Start FastAPI server")
    s.add_argument("--host", default="127.0.0.1")
    s.add_argument("--port", type=int, default=8765)
    s.add_argument("--reload", action="store_true")
    s.set_defaults(func=cmd_serve)

    # list
    s = sub.add_parser("list", help="List notes by type or tag")
    s.add_argument("--type", help="Frontmatter type (e.g. service, store, feature)")
    s.add_argument("--tag", help="Tag to filter by")
    s.set_defaults(func=cmd_list)

    # install-hooks
    s = sub.add_parser("install-hooks", help="Install git hooks for auto-sync on commit/push")
    s.add_argument("--force", action="store_true", help="Overwrite existing hooks")
    s.set_defaults(func=cmd_install_hooks)

    # uninstall-hooks
    s = sub.add_parser("uninstall-hooks", help="Remove kromi-doc git hooks")
    s.set_defaults(func=cmd_uninstall_hooks)

    # hooks-status
    s = sub.add_parser("hooks-status", help="Show installed git hooks")
    s.set_defaults(func=cmd_hooks_status)

    return p


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.project_root is None:
        args.project_root = _resolve_project_root()
    _load_dotenv(args.project_root)

    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
