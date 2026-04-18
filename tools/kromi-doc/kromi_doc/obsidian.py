"""Obsidian vault client with automatic filesystem fallback.

Primary: HTTP API exposed by the 'Obsidian Local REST API' plugin.
Fallback: Direct filesystem read/write to the vault folder on disk.

When Obsidian is closed (API unreachable), all operations transparently
fall back to direct file I/O. Obsidian auto-detects filesystem changes
when it reopens.
"""
from __future__ import annotations

import os
import urllib.parse
from pathlib import Path
from typing import Any

import requests


# Default vault path — override via OBSIDIAN_VAULT_PATH env var
_DEFAULT_VAULT = os.path.expanduser(
    os.environ.get(
        "OBSIDIAN_VAULT_PATH",
        os.path.join(os.path.expanduser("~"), "Documents", "OBSIDIAN VAULTS", "KROMI_BIKECONTROL", "KROMI_BIKECONTROL"),
    )
)


class ObsidianClient:
    def __init__(
        self,
        base_url: str | None = None,
        api_key: str | None = None,
        vault_path: str | None = None,
    ) -> None:
        self.base_url = (base_url or os.environ.get("OBSIDIAN_API_URL", "http://127.0.0.1:27123")).rstrip("/")
        self.api_key = api_key or os.environ.get("OBSIDIAN_API_KEY", "")
        self.vault_dir = Path(vault_path or _DEFAULT_VAULT)
        self._api_available: bool | None = None  # lazy-checked on first call

        if not self.api_key and not self.vault_dir.is_dir():
            raise RuntimeError(
                "OBSIDIAN_API_KEY is required when vault path is not available on disk. "
                f"Set OBSIDIAN_API_KEY env var or ensure vault exists at: {self.vault_dir}"
            )

    # ─── Transport selection ────────────────────────────────
    @property
    def _use_api(self) -> bool:
        """Check if REST API is available, cache result for session."""
        if self._api_available is None:
            self._api_available = self._ping_api()
            if not self._api_available and self.vault_dir.is_dir():
                print(f"[kromi-doc] Obsidian API offline — using filesystem fallback: {self.vault_dir}")
            elif not self._api_available:
                print("[kromi-doc] WARNING: Obsidian API offline and vault path not found on disk")
        return self._api_available

    def _vault_file(self, path: str) -> Path:
        """Resolve a vault-relative path to an absolute filesystem path."""
        return self.vault_dir / path.replace("/", os.sep)

    # ─── Headers ────────────────────────────────────────────
    def _headers(self, extra: dict[str, str] | None = None) -> dict[str, str]:
        h = {"Authorization": f"Bearer {self.api_key}"}
        if extra:
            h.update(extra)
        return h

    # ─── Path helpers ───────────────────────────────────────
    @staticmethod
    def _encode(path: str) -> str:
        return urllib.parse.quote(path, safe="/")

    def _url(self, path: str) -> str:
        return f"{self.base_url}/vault/{self._encode(path)}"

    # ─── Verbs ──────────────────────────────────────────────
    def get(self, path: str) -> str | None:
        """Read a note. Returns content as string, or None if not found."""
        if self._use_api:
            try:
                r = requests.get(self._url(path), headers=self._headers(), timeout=10)
                if r.status_code == 404:
                    return None
                r.raise_for_status()
                return r.text
            except requests.ConnectionError:
                self._api_available = False

        # Filesystem fallback
        fp = self._vault_file(path)
        if fp.is_file():
            return fp.read_text(encoding="utf-8")
        return None

    def put(self, path: str, content: str) -> bool:
        """Create or replace a note. Returns True on success."""
        if self._use_api:
            try:
                r = requests.put(
                    self._url(path),
                    data=content.encode("utf-8"),
                    headers=self._headers({"Content-Type": "text/markdown"}),
                    timeout=15,
                )
                return r.status_code in (200, 201, 204)
            except requests.ConnectionError:
                self._api_available = False

        # Filesystem fallback
        fp = self._vault_file(path)
        try:
            fp.parent.mkdir(parents=True, exist_ok=True)
            fp.write_text(content, encoding="utf-8")
            return True
        except OSError as e:
            print(f"[kromi-doc] filesystem write failed: {fp} — {e}")
            return False

    def delete(self, path: str) -> bool:
        """Delete a note. Returns True on success or already gone."""
        if self._use_api:
            try:
                r = requests.delete(self._url(path), headers=self._headers(), timeout=10)
                return r.status_code in (200, 204, 404)
            except requests.ConnectionError:
                self._api_available = False

        # Filesystem fallback
        fp = self._vault_file(path)
        try:
            if fp.is_file():
                fp.unlink()
            return True
        except OSError:
            return False

    def list_dir(self, path: str = "") -> list[str]:
        """List entries in a vault folder. Returns filenames + subfolders."""
        if self._use_api:
            try:
                url = self._url(path)
                if not url.endswith("/"):
                    url += "/"
                r = requests.get(url, headers=self._headers(), timeout=10)
                if r.status_code == 404:
                    return []
                r.raise_for_status()
                data = r.json()
                return data.get("files", [])
            except requests.ConnectionError:
                self._api_available = False

        # Filesystem fallback
        dp = self._vault_file(path) if path else self.vault_dir
        if not dp.is_dir():
            return []
        entries: list[str] = []
        for item in sorted(dp.iterdir()):
            if item.name.startswith("."):
                continue
            if item.is_dir():
                entries.append(item.name + "/")
            else:
                entries.append(item.name)
        return entries

    def walk(self, path: str = "") -> list[str]:
        """Recursively list all .md files under a folder. Returns relative paths."""
        if not self._use_api and self.vault_dir.is_dir():
            # Fast filesystem walk
            base = self._vault_file(path) if path else self.vault_dir
            if not base.is_dir():
                return []
            out: list[str] = []
            for f in base.rglob("*.md"):
                if any(p.startswith(".") for p in f.relative_to(self.vault_dir).parts):
                    continue
                out.append(f.relative_to(self.vault_dir).as_posix())
            return sorted(out)

        # API-based walk (original recursive approach)
        out = []
        try:
            entries = self.list_dir(path)
        except Exception:
            return out
        for entry in entries:
            full = f"{path}{entry}" if path else entry
            if entry.endswith("/"):
                out.extend(self.walk(full))
            elif entry.endswith(".md"):
                out.append(full)
        return out

    def ping(self) -> bool:
        """Health check. Returns True if API or filesystem is available."""
        if self._ping_api():
            return True
        return self.vault_dir.is_dir()

    def _ping_api(self) -> bool:
        """Check if the REST API is reachable."""
        try:
            r = requests.get(f"{self.base_url}/vault/", headers=self._headers(), timeout=5)
            return r.status_code == 200
        except Exception:
            return False

    @property
    def mode(self) -> str:
        """Return current transport mode for diagnostics."""
        if self._use_api:
            return "api"
        if self.vault_dir.is_dir():
            return "filesystem"
        return "unavailable"
