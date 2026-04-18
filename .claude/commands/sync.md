# /sync — Sync Obsidian Vault & Documentation

Sync KROMI BikeControl documentation to Obsidian vault and verify kromi-doc state.

## Usage
- `/sync status` — check kromi-doc sync status (git hooks installed, last sync)
- `/sync obsidian` — verify Obsidian vault connectivity and list recent changes
- `/sync docs` — run `kromi-doc validate` to check documentation integrity
- `/sync search <query>` — search documentation via `kromi-doc search`

## How It Works
- kromi-doc auto-syncs via git hooks (pre-commit + post-push)
- Obsidian vault at port 27124 (local REST API)
- NEVER manually sync — use git hooks only
- To reinstall hooks: `PYTHONIOENCODING=utf-8 kromi-doc install-hooks --force`

## Obsidian Access
- MCP tools: `mcp__obsidian__obsidian_*`
- Direct API: `curl -s -k -H "Authorization: Bearer <key>" https://127.0.0.1:27124/vault/`

## Key Commands
```bash
PYTHONIOENCODING=utf-8 kromi-doc validate    # check integrity
PYTHONIOENCODING=utf-8 kromi-doc search "query" --top-k 5
PYTHONIOENCODING=utf-8 kromi-doc list --type feature
PYTHONIOENCODING=utf-8 kromi-doc deps        # dependency graph
```
