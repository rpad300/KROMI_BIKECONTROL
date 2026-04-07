# `kromi-doc` — Obsidian vault automation for KROMI BikeControl

A Python tool that keeps the KROMI Obsidian vault in sync with the codebase, provides semantic search over notes, generates new notes from templates, validates wikilinks, and visualises service dependencies.

Inspired by `claude-code-blueprint/OBSIDIAN-SYNC-BLUEPRINT.md`.

---

## What it does

| Subcommand | What |
|---|---|
| `sync` | Re-generate `Stores/`, `Hooks/`, `Services/`, `Components/`, `Edge-Functions/`, `Database/` from source code + Supabase schema |
| `search` | Semantic search across all vault notes (TF-IDF or sentence-transformers) |
| `embed` | (Re-)build the embeddings index |
| `validate` | Check wikilinks resolve, frontmatter is valid, no orphans |
| `new` | Create a new note from a template (`feature`, `decision`, `module`, `service`, `use-case`) |
| `deps` | Generate the service dependency graph as a Mermaid note |
| `serve` | Start a FastAPI server exposing the same operations over HTTP |
| `list` | List notes by type or tag |

---

## Install

From the project root:

```bash
cd tools/kromi-doc
pip install -e .

# Optional extras
pip install -e ".[embeddings]"   # for sentence-transformers semantic search
pip install -e ".[server]"       # for FastAPI HTTP server
pip install -e ".[all]"          # everything
```

---

## Configuration

Set environment variables (or pass as CLI flags):

```bash
export OBSIDIAN_API_URL=http://127.0.0.1:27123
export OBSIDIAN_API_KEY=1b56f567...        # from Obsidian Local REST API plugin
export KROMI_PROJECT_ROOT=/path/to/KROMI_BIKECONTROL
export SUPABASE_PROJECT_ID=ctsuupvmmyjlrtjnxagv
```

The CLI also reads `.env` from the project root if present.

---

## Usage

### Full sync (everything)
```bash
kromi-doc sync --full
```

### Sync only one category
```bash
kromi-doc sync --only stores
kromi-doc sync --only services
kromi-doc sync --only database
```

### Dry-run (show what would change)
```bash
kromi-doc sync --full --dry-run
```

### Semantic search
```bash
kromi-doc search "how does authentication work"
kromi-doc search "where is bike fit data stored"
kromi-doc search "edge function deployment"
```

### Build embeddings index
```bash
kromi-doc embed                  # uses TF-IDF by default
kromi-doc embed --model st       # uses sentence-transformers (heavier)
```

### Create a new note from a template
```bash
kromi-doc new feature "Strava Sync" --output 01-Business/Feature-Strava-Sync.md
kromi-doc new decision "Use Cloudflare R2 for storage" --output 01-Business/Decision-Log.md --append
kromi-doc new module "M12 Crash Detection" --output 05-Modules/M12-Crash-Detection.md
```

### Validate the vault
```bash
kromi-doc validate                  # checks all wikilinks + frontmatter
kromi-doc validate --fix            # auto-fix what's safe (e.g. update `updated:`)
```

### Generate the dependency graph
```bash
kromi-doc deps                      # writes 03-Architecture/Dependency-Graph.md
kromi-doc deps --category bluetooth # only the bluetooth/ folder
```

### List notes
```bash
kromi-doc list --type service
kromi-doc list --tag rbac
```

### Start the FastAPI server
```bash
kromi-doc serve --port 8765
# Then:
curl -X POST http://localhost:8765/sync
curl http://localhost:8765/search?q=authentication
curl http://localhost:8765/health
```

---

## Wire to git hooks (one command)

```bash
kromi-doc install-hooks
```

This installs **two** hooks in `.git/hooks/`:

| Hook | When | What it runs |
|---|---|---|
| `post-commit` | Every commit | `kromi-doc sync --full` |
| `pre-push` | Every push | `kromi-doc sync --full && kromi-doc deps && kromi-doc embed && kromi-doc validate` |

Both hooks are **non-blocking**: if Obsidian is offline or the API key isn't set, the commit/push proceeds anyway. Your work is never blocked by docs being out of sync.

### Manage hooks

```bash
kromi-doc install-hooks           # install (idempotent)
kromi-doc install-hooks --force   # overwrite even non-kromi hooks
kromi-doc uninstall-hooks         # remove (only removes kromi-doc hooks)
kromi-doc hooks-status            # show what's installed
```

### Requirements for the hooks to actually run

1. `kromi-doc` must be on the `$PATH` (`pip install -e tools/kromi-doc` once)
2. `OBSIDIAN_API_KEY` must be in `.env` at the project root
3. Obsidian must be running locally with the **Local REST API** plugin enabled
4. (For embeddings) the embeddings index will be rebuilt on every push — slow but cheap (TF-IDF, ~5s)

If any of these is missing, the hook silently exits with status 0. You'll see no error and the commit proceeds.

---

## Architecture

```
kromi-doc/
├── pyproject.toml
├── README.md (this file)
├── kromi_doc/
│   ├── __init__.py
│   ├── __main__.py        # python -m kromi_doc
│   ├── cli.py             # argparse subcommands
│   ├── obsidian.py        # REST API client (GET / PUT / DELETE)
│   ├── sync.py            # auto-sync engine (consolidates all generators)
│   ├── embeddings.py      # TF-IDF + optional sentence-transformers
│   ├── new_note.py        # template rendering
│   ├── validate.py        # wikilink + frontmatter checker
│   ├── deps.py            # service dependency graph (Mermaid)
│   └── server.py          # FastAPI wrapper
└── templates/
    ├── feature.md
    ├── decision.md
    ├── module.md
    ├── service.md
    └── use_case.md
```

---

## Idempotency

All operations are **idempotent**:
- `sync` only writes notes whose content actually changed
- `embed` only re-embeds notes whose hash changed since the last run
- `new --append` won't duplicate if the section already exists
- `validate` is read-only by default

---

## Limitations

- **Embeddings:** the default TF-IDF mode is fast and works offline but is less semantic than transformer models. Install `[embeddings]` extra to use `sentence-transformers all-MiniLM-L6-v2` (~80MB model download on first use).
- **Obsidian REST API:** must be running locally on port 27123 for sync/validate/list to work. The plugin is `Obsidian Local REST API` by Adam Coddington.
- **Source of truth:** The actual `.ts`/`.tsx` source files in `src/` are always the source of truth. Notes are generated views of them.
- **No DB writes:** `kromi-doc` only reads Supabase via the MCP. It never writes to your database.

---

## Convention reminder

Following [[CLAUDE.md]] and `Decision-Log#ADR-006`:

- ALL file uploads in KROMI go through `services/storage/KromiFileStore.ts`. NEVER bypass.
- ALL BLE subscriptions go through `services/bluetooth/BLEBridge.ts`. NEVER call `navigator.bluetooth` directly.
- The Obsidian vault is **generated**, not hand-edited. If a note is wrong, fix the generator (in `kromi_doc/sync.py`), not the note.
