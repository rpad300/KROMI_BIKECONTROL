"""Git hook installer + uninstaller.

Writes `post-commit` and `pre-push` hooks into `.git/hooks/` so the
Obsidian vault stays in sync automatically — no manual sync needed.

The hooks are non-blocking: if Obsidian is offline, kromi-doc isn't
installed, or anything goes wrong, the commit/push proceeds anyway.
"""
from __future__ import annotations

import os
import stat
from pathlib import Path
from typing import Iterable

# ─── Hook content ───────────────────────────────────────────

POST_COMMIT_HOOK = """#!/usr/bin/env bash
# kromi-doc auto-sync (post-commit)
# Installed by `kromi-doc install-hooks`. Non-blocking.

if ! command -v kromi-doc >/dev/null 2>&1; then
  exit 0
fi

# Source .env if present so OBSIDIAN_API_KEY is set
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

if [ -z "${OBSIDIAN_API_KEY:-}" ]; then
  exit 0
fi

# Force UTF-8 output on Windows
export PYTHONIOENCODING=utf-8

echo "[kromi-doc] post-commit: syncing vault..."
kromi-doc sync --full 2>&1 | tail -3 || true
"""


PRE_PUSH_HOOK = """#!/usr/bin/env bash
# kromi-doc auto-sync (pre-push)
# Installed by `kromi-doc install-hooks`. Non-blocking.
# Runs full sync + dependency graph + embeddings + validate.

if ! command -v kromi-doc >/dev/null 2>&1; then
  exit 0
fi

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

if [ -z "${OBSIDIAN_API_KEY:-}" ]; then
  exit 0
fi

# Force UTF-8 output on Windows (Python prints unicode in summaries)
export PYTHONIOENCODING=utf-8

echo "[kromi-doc] pre-push: full vault sync + deps + embeddings..."
kromi-doc sync --full 2>&1 | tail -5 || true
kromi-doc deps 2>&1 || true
kromi-doc embed 2>&1 || true
kromi-doc validate 2>&1 | head -10 || true
echo "[kromi-doc] pre-push: done"
"""


HOOKS = {
    "post-commit": POST_COMMIT_HOOK,
    "pre-push": PRE_PUSH_HOOK,
}

MARKER = "# Installed by `kromi-doc install-hooks`"


def _git_hooks_dir(project_root: Path) -> Path | None:
    """Locate .git/hooks/ for the project."""
    git_dir = project_root / ".git"
    if not git_dir.exists():
        return None
    # Handle worktrees: .git can be a file pointing to .git/worktrees/X
    if git_dir.is_file():
        text = git_dir.read_text(encoding="utf-8")
        if text.startswith("gitdir:"):
            real = Path(text.split(":", 1)[1].strip())
            git_dir = real
    return git_dir / "hooks"


def install_hooks(project_root: Path, force: bool = False) -> tuple[int, list[str]]:
    """Install all hooks. Returns (count_installed, messages)."""
    hooks_dir = _git_hooks_dir(project_root)
    if hooks_dir is None:
        return 0, ["[!] Not a git repository (no .git dir found)"]
    hooks_dir.mkdir(parents=True, exist_ok=True)

    installed = 0
    messages: list[str] = []
    for name, content in HOOKS.items():
        path = hooks_dir / name
        if path.exists() and not force:
            existing = path.read_text(encoding="utf-8", errors="replace")
            if MARKER in existing:
                # Our hook — overwrite (idempotent)
                pass
            else:
                messages.append(f"[skip] {name} already exists (use --force to overwrite)")
                continue

        path.write_text(content, encoding="utf-8", newline="\n")
        # Make executable on POSIX. On Windows + git-bash, file is interpreted by bash regardless.
        try:
            path.chmod(path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
        except Exception:
            pass

        installed += 1
        messages.append(f"[OK] Installed {name}")

    return installed, messages


def uninstall_hooks(project_root: Path) -> tuple[int, list[str]]:
    """Remove our hooks (only if they have our marker)."""
    hooks_dir = _git_hooks_dir(project_root)
    if hooks_dir is None:
        return 0, ["[!] Not a git repository"]

    removed = 0
    messages: list[str] = []
    for name in HOOKS.keys():
        path = hooks_dir / name
        if not path.exists():
            continue
        content = path.read_text(encoding="utf-8", errors="replace")
        if MARKER in content:
            path.unlink()
            removed += 1
            messages.append(f"[OK] Removed {name}")
        else:
            messages.append(f"[skip] {name} is not a kromi-doc hook")
    return removed, messages


def hook_status(project_root: Path) -> list[str]:
    """List which hooks are installed."""
    hooks_dir = _git_hooks_dir(project_root)
    if hooks_dir is None:
        return ["Not a git repository"]
    out: list[str] = []
    for name in HOOKS.keys():
        path = hooks_dir / name
        if not path.exists():
            out.append(f"  [ ] {name}  (not installed)")
            continue
        content = path.read_text(encoding="utf-8", errors="replace")
        marker = "kromi-doc" if MARKER in content else "other (NOT kromi-doc)"
        out.append(f"  [x] {name}  ({marker})")
    return out
