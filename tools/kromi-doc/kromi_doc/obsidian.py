"""Obsidian Local REST API client.

Wraps the HTTP API exposed by the 'Obsidian Local REST API' plugin.
Used by sync, validate, list, and search subcommands.
"""
from __future__ import annotations

import os
import urllib.parse
from typing import Any

import requests


class ObsidianClient:
    def __init__(self, base_url: str | None = None, api_key: str | None = None) -> None:
        self.base_url = (base_url or os.environ.get("OBSIDIAN_API_URL", "http://127.0.0.1:27123")).rstrip("/")
        self.api_key = api_key or os.environ.get("OBSIDIAN_API_KEY", "")
        if not self.api_key:
            raise RuntimeError("OBSIDIAN_API_KEY is required (env var or constructor argument)")

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
        """Read a note. Returns content as string, or None if 404."""
        r = requests.get(self._url(path), headers=self._headers(), timeout=10)
        if r.status_code == 404:
            return None
        r.raise_for_status()
        return r.text

    def put(self, path: str, content: str) -> bool:
        """Create or replace a note. Returns True on success."""
        r = requests.put(
            self._url(path),
            data=content.encode("utf-8"),
            headers=self._headers({"Content-Type": "text/markdown"}),
            timeout=15,
        )
        return r.status_code in (200, 201, 204)

    def delete(self, path: str) -> bool:
        """Delete a note. Returns True on success or 404 (already gone)."""
        r = requests.delete(self._url(path), headers=self._headers(), timeout=10)
        return r.status_code in (200, 204, 404)

    def list_dir(self, path: str = "") -> list[str]:
        """List entries in a vault folder. Returns filenames + subfolders."""
        url = self._url(path)
        if not url.endswith("/"):
            url += "/"
        r = requests.get(url, headers=self._headers(), timeout=10)
        if r.status_code == 404:
            return []
        r.raise_for_status()
        data = r.json()
        return data.get("files", [])

    def walk(self, path: str = "") -> list[str]:
        """Recursively list all .md files under a folder. Returns relative paths."""
        out: list[str] = []
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
        """Health check."""
        try:
            r = requests.get(f"{self.base_url}/vault/", headers=self._headers(), timeout=5)
            return r.status_code == 200
        except Exception:
            return False
