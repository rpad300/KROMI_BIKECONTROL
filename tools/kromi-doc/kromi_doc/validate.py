"""Vault validator: checks wikilinks resolve, frontmatter is parseable,
and reports orphans (notes nobody links to)."""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

from kromi_doc.obsidian import ObsidianClient

WIKILINK_RE = re.compile(r"\[\[([^\]|]+)(?:\|[^\]]*)?\]\]")
FRONTMATTER_RE = re.compile(r"^---\n(.*?)\n---", re.DOTALL)


@dataclass
class ValidationReport:
    total_notes: int = 0
    broken_links: list[tuple[str, str]] = field(default_factory=list)
    missing_frontmatter: list[str] = field(default_factory=list)
    orphans: list[str] = field(default_factory=list)
    fixed: int = 0

    def is_clean(self) -> bool:
        return not (self.broken_links or self.missing_frontmatter)

    def summary(self) -> str:
        lines = ["", "── Validation report ──────────────────────────────"]
        lines.append(f"  Total notes:        {self.total_notes}")
        lines.append(f"  Broken wikilinks:   {len(self.broken_links)}")
        lines.append(f"  Missing frontmatter:{len(self.missing_frontmatter)}")
        lines.append(f"  Orphans:            {len(self.orphans)}")
        if self.fixed:
            lines.append(f"  Auto-fixed:         {self.fixed}")
        if self.broken_links:
            lines.append("\n  Broken links (first 20):")
            for src, target in self.broken_links[:20]:
                lines.append(f"    {src} -> [[{target}]]")
        if self.missing_frontmatter:
            lines.append("\n  Missing frontmatter (first 20):")
            for n in self.missing_frontmatter[:20]:
                lines.append(f"    {n}")
        return "\n".join(lines)


class VaultValidator:
    def __init__(self, client: ObsidianClient, fix: bool = False) -> None:
        self.client = client
        self.fix = fix
        self.report = ValidationReport()

    def run(self) -> ValidationReport:
        all_notes = self.client.walk("")
        self.report.total_notes = len(all_notes)

        # Build a set of resolvable note names (without folder, without extension)
        names: set[str] = set()
        full_paths: set[str] = set()
        for p in all_notes:
            full_paths.add(p[:-3] if p.endswith(".md") else p)
            stem = p.rsplit("/", 1)[-1]
            if stem.endswith(".md"):
                stem = stem[:-3]
            names.add(stem)

        # Track inbound links to detect orphans
        inbound: dict[str, int] = {n: 0 for n in names}

        for path in all_notes:
            content = self.client.get(path) or ""

            # Frontmatter check
            if not FRONTMATTER_RE.match(content):
                self.report.missing_frontmatter.append(path)

            # Link extraction
            for link_target in WIKILINK_RE.findall(content):
                # Strip anchor (#section) and trim spaces
                target = link_target.split("#")[0].strip()
                if not target:
                    continue
                # Resolve as full path or as bare name
                if target in full_paths:
                    name = target.rsplit("/", 1)[-1]
                    inbound[name] = inbound.get(name, 0) + 1
                elif target in names:
                    inbound[target] = inbound.get(target, 0) + 1
                else:
                    # Try without folder prefix (some links omit folder)
                    bare = target.rsplit("/", 1)[-1]
                    if bare in names:
                        inbound[bare] = inbound.get(bare, 0) + 1
                    else:
                        self.report.broken_links.append((path, target))

        # Orphans = notes nobody links to (excluding indexes + entry points)
        ENTRY_POINTS = {"MOC", "Bem-vindo", "Vault-Navigation"}
        for name, count in inbound.items():
            if count == 0 and name not in ENTRY_POINTS and not name.startswith("_"):
                self.report.orphans.append(name)

        return self.report
