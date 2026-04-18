# KROMI BikeControl — Custom Commands

## Available Commands

| Command | Description |
|---------|-------------|
| `/status` | Project status dashboard — git, build, dependencies, Supabase, edge functions, deploy |
| `/deploy` | Deploy workflow — type-check → build → test → confirm → Vercel deploy |
| `/db` | Supabase database operations — tables, migrate, rls, sql, logs, edge functions |
| `/ble` | BLE protocol debugging — services, protocols, simulate, debug logs, trace |
| `/ride-sim` | Simulation mode manager — on/off, status, scenarios (climb, descent, flat, mixed) |
| `/sync` | Sync documentation — Obsidian vault connectivity, kromi-doc status, search docs |

## Usage

Type the command name in Claude Code to invoke:

```
/status
/deploy
/db tables
/ble protocol gev
/ride-sim on
/sync status
```

## How Commands Work

Commands are markdown files in `.claude/commands/`. When invoked, Claude reads the file and follows the instructions. Each command defines:
- What information to gather
- What tools to use (Bash, MCP, etc.)
- What format to present results
- Safety rules (e.g., `/deploy` requires confirmation)

## Adding New Commands

Create a new `.md` file in `.claude/commands/` with:
1. Title and purpose
2. Usage variants (subcommands)
3. Step-by-step instructions for Claude
4. Safety rules and constraints
