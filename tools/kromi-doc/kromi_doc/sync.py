"""Auto-sync engine: regenerates entity notes from source code.

Consolidates the previous one-off scripts into a single re-runnable engine.
Each category (stores, hooks, services, components, edge_functions, database)
has its own generator method.

Idempotent: only writes notes whose content has actually changed (hash compare).
"""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from kromi_doc.obsidian import ObsidianClient


# ─── Constants ──────────────────────────────────────────────

SERVICE_CATEGORY_DESC: dict[str, str] = {
    "accessories": "Smart accessories (lights, radar, TPMS) routing + multi-device management",
    "auth": "OTP authentication, device tokens, session verification",
    "autoAssist": "Auto-assist engine, elevation prediction, battery optimizer, override learning",
    "battery": "Battery estimation, consumption calibration, historical range estimator",
    "bike": "Bike component metadata + Gemini AI summaries",
    "bluetooth": "BLE service implementations for all motor brands + accessories + sensors",
    "di2": "Shimano Di2 integration (gear position, shift inhibit, gear efficiency)",
    "export": "Ride export to GPX format",
    "heartRate": "HR zones engine + biometric assist (W' balance, cardiac drift)",
    "import": "FIT/historical data import, weather backfill, route terrain enrichment",
    "intelligence": "KROMI Intelligence v2 — 7 layers: Physics, Physiology, Environment, Lookahead, Battery, Learning, Nutrition",
    "learning": "Adaptive learning, ride data collector, profile sync, battery efficiency",
    "maintenance": "Service book + shop management + maintenance notifications",
    "maps": "Google Maps, Elevation, Komoot import, Navigation, Terrain (OpenStreetMap)",
    "motor": "Motor command controller + tuning intelligence",
    "rbac": "Roles, permissions, user feature flags, impersonation log (Session 16)",
    "routes": "GPX parser, pre-ride analysis, route CRUD",
    "sensors": "Adaptive brightness + Web Sensor API",
    "simulation": "Bike simulator for development without hardware",
    "storage": "Unified file store (Google Drive backend), local IndexedDB ride store, user preferences (Session 16)",
    "sync": "Bike profile sync, login tracker, settings sync, sync queue",
    "torque": "Torque engine + GEV torque writer",
    "weather": "OpenMeteo (free) + Google Weather (fallback)",
}

EXPORT_RE = re.compile(
    r"^export\s+(?:async\s+)?(?:default\s+)?(?:const|let|function|class|interface|type|enum)\s+(\w+)",
    re.MULTILINE,
)
IMPORT_RE = re.compile(r"^import\s+[^'\"]+['\"]([^'\"]+)['\"]", re.MULTILINE)


@dataclass
class SyncStats:
    written: int = 0
    skipped_unchanged: int = 0
    failed: int = 0
    by_category: dict[str, int] = field(default_factory=dict)


class SyncEngine:
    def __init__(self, project_root: Path, client: ObsidianClient, dry_run: bool = False) -> None:
        self.root = Path(project_root).resolve()
        self.client = client
        self.dry_run = dry_run
        self.stats = SyncStats()

    # ─── Helpers ────────────────────────────────────────────
    def _read(self, p: Path) -> str:
        try:
            return p.read_text(encoding="utf-8")
        except Exception:
            return ""

    def _put(self, vault_path: str, content: str) -> bool:
        """Idempotent put: skip if existing content matches."""
        existing = self.client.get(vault_path)
        if existing is not None and self._hash(existing) == self._hash(content):
            self.stats.skipped_unchanged += 1
            return True
        if self.dry_run:
            print(f"  [DRY] would write {vault_path} ({len(content)} chars)")
            self.stats.written += 1
            return True
        ok = self.client.put(vault_path, content)
        if ok:
            self.stats.written += 1
        else:
            self.stats.failed += 1
        return ok

    @staticmethod
    def _hash(s: str) -> str:
        return hashlib.sha256(s.encode("utf-8")).hexdigest()

    @staticmethod
    def _extract_top_comment(src: str) -> str:
        for line in src.splitlines()[:30]:
            s = line.strip()
            if s.startswith("//") and not s.startswith("// ─") and not s.startswith("// ═"):
                return s.lstrip("/").strip()
            if s.startswith("/*") or s.startswith("*"):
                cleaned = s.lstrip("/*").rstrip("*/").strip()
                if cleaned and len(cleaned) > 5:
                    return cleaned
        return ""

    @staticmethod
    def _extract_exports(src: str) -> list[str]:
        return list(dict.fromkeys(EXPORT_RE.findall(src)))[:20]

    @staticmethod
    def _extract_internal_imports(src: str) -> list[str]:
        return [m for m in IMPORT_RE.findall(src) if m.startswith(".")][:15]

    # ─── Public API ─────────────────────────────────────────
    def sync_category(self, category: str) -> None:
        method = {
            "stores": self.sync_stores,
            "hooks": self.sync_hooks,
            "services": self.sync_services,
            "components": self.sync_components,
            "edge_functions": self.sync_edge_functions,
            "database": self.sync_database,
        }.get(category)
        if not method:
            print(f"  [!] Unknown category: {category}")
            return
        before = self.stats.written
        method()
        self.stats.by_category[category] = self.stats.written - before

    def summary(self) -> str:
        lines = [
            "",
            "── Sync summary ──────────────────────────────",
            f"  Written:           {self.stats.written}",
            f"  Skipped unchanged: {self.stats.skipped_unchanged}",
            f"  Failed:            {self.stats.failed}",
            "",
        ]
        for cat, n in self.stats.by_category.items():
            lines.append(f"    {cat}: {n}")
        if self.dry_run:
            lines.append("\n  (dry-run — no writes performed)")
        return "\n".join(lines)

    # ─── Generators ─────────────────────────────────────────

    def sync_stores(self) -> None:
        src_dir = self.root / "src" / "store"
        if not src_dir.exists():
            return
        for p in sorted(src_dir.glob("*.ts")):
            self._gen_store(p)

    def _gen_store(self, p: Path) -> None:
        name = p.stem
        src = self._read(p)
        comment = self._extract_top_comment(src)
        exports = self._extract_exports(src)
        persisted = "persist(" in src
        loc = len(src.splitlines())

        body = "---\n"
        body += f'title: "{name}"\n'
        body += "type: store\n"
        body += "tags: [zustand, store, frontend]\n"
        body += f'file: "src/store/{p.name}"\n'
        body += f"persisted: {'true' if persisted else 'false'}\n"
        body += f"lines: {loc}\n"
        body += "---\n\n"
        body += f"# `{name}`\n\n"
        if comment:
            body += f"> {comment[:200]}\n\n"
        if persisted:
            body += "**Persisted:** Zustand `persist` middleware → localStorage\n\n"
        if exports:
            body += "## Exports\n\n"
            for e in exports:
                body += f"- `{e}`\n"
            body += "\n"
        body += f"## Source\n\n`src/store/{p.name}` ({loc} lines)\n\n"
        body += "## Related\n\n- [[Stores/_Index]]\n- [[Stores-Data-Flow]]\n"

        self._put(f"Stores/{name}.md", body)

    def sync_hooks(self) -> None:
        src_dir = self.root / "src" / "hooks"
        if not src_dir.exists():
            return
        for p in sorted(src_dir.glob("*.ts")):
            self._gen_hook(p)

    def _gen_hook(self, p: Path) -> None:
        name = p.stem
        src = self._read(p)
        comment = self._extract_top_comment(src)
        exports = self._extract_exports(src)
        loc = len(src.splitlines())

        body = "---\n"
        body += f'title: "{name}"\n'
        body += "type: hook\n"
        body += "tags: [react, hook, frontend]\n"
        body += f'file: "src/hooks/{p.name}"\n'
        body += f"lines: {loc}\n"
        body += "---\n\n"
        body += f"# `{name}`\n\n"
        if comment:
            body += f"> {comment[:200]}\n\n"
        if exports:
            body += "## Exports\n\n"
            for e in exports:
                body += f"- `{e}`\n"
            body += "\n"
        body += f"## Source\n\n`src/hooks/{p.name}` ({loc} lines)\n\n"
        body += "## Related\n\n- [[Hooks/_Index]]\n"

        self._put(f"Hooks/{name}.md", body)

    def sync_services(self) -> None:
        src_dir = self.root / "src" / "services"
        if not src_dir.exists():
            return
        categories: dict[str, list[Path]] = {}
        for p in sorted(src_dir.rglob("*.ts")):
            if not p.is_file():
                continue
            rel = p.relative_to(src_dir)
            if len(rel.parts) < 2:
                continue
            categories.setdefault(rel.parts[0], []).append(p)

        for cat, files in sorted(categories.items()):
            for p in files:
                self._gen_service(p, cat)
            self._gen_service_category_index(cat, files)

        # Master services index
        master = "---\n"
        master += 'title: "All Services"\n'
        master += "type: index\n"
        master += "tags: [service, index]\n"
        master += "---\n\n"
        master += "# All Services\n\n"
        total = sum(len(f) for f in categories.values())
        master += f"{total} services across {len(categories)} categories.\n\n"
        master += "| Category | Files | Purpose |\n|---|---|---|\n"
        for cat in sorted(categories.keys()):
            master += f"| [[Services/{cat}/_Index|{cat}]] | {len(categories[cat])} | {SERVICE_CATEGORY_DESC.get(cat, '')} |\n"
        master += "\n## Related\n\n- [[Arquitectura-Geral]]\n"
        self._put("Services/_Index.md", master)

    def _gen_service(self, p: Path, category: str) -> None:
        name = p.stem
        src = self._read(p)
        comment = self._extract_top_comment(src)
        exports = self._extract_exports(src)
        imports = self._extract_internal_imports(src)
        rel = p.relative_to(self.root)
        loc = len(src.splitlines())

        body = "---\n"
        body += f'title: "{name}"\n'
        body += "type: service\n"
        body += f"category: {category}\n"
        body += f"tags: [service, {category}]\n"
        body += f'file: "{rel.as_posix()}"\n'
        body += f"lines: {loc}\n"
        body += "---\n\n"
        body += f"# `{name}`\n\n"
        if comment:
            body += f"> {comment[:200]}\n\n"
        if exports:
            body += "## Exports\n\n"
            for e in exports:
                body += f"- `{e}`\n"
            body += "\n"
        if imports:
            body += "## Internal dependencies\n\n"
            for imp in imports:
                body += f"- `{imp}`\n"
            body += "\n"
        body += f"## Source\n\n`{rel.as_posix()}` ({loc} lines)\n\n"
        body += "## Related\n\n"
        body += f"- [[Services/{category}/_Index|{category} services]]\n"
        body += "- [[Services/_Index|All Services]]\n"

        rel_in_services = p.relative_to(self.root / "src" / "services")
        vault_path = f"Services/{rel_in_services.with_suffix('').as_posix()}.md"
        self._put(vault_path, body)

    def _gen_service_category_index(self, cat: str, files: list[Path]) -> None:
        body = "---\n"
        body += f'title: "{cat} services"\n'
        body += "type: index\n"
        body += f"category: {cat}\n"
        body += f"tags: [service, index, {cat}]\n"
        body += "---\n\n"
        body += f"# `{cat}` Services\n\n"
        body += f"> {SERVICE_CATEGORY_DESC.get(cat, '')}\n\n"
        body += f"{len(files)} files in this category.\n\n"
        body += "| Service | Source |\n|---|---|\n"
        for p in files:
            n = p.stem
            rel = p.relative_to(self.root)
            body += f"| [[Services/{cat}/{n}|{n}]] | `{rel.as_posix()}` |\n"
        body += "\n## Related\n\n- [[Services/_Index|All Services]]\n"
        self._put(f"Services/{cat}/_Index.md", body)

    def sync_components(self) -> None:
        src_dir = self.root / "src" / "components"
        if not src_dir.exists():
            return
        areas = sorted([d for d in src_dir.iterdir() if d.is_dir()])
        for area in areas:
            files = sorted(area.rglob("*.tsx"))
            self._gen_component_area(area, files)

        # Index
        idx = "---\n"
        idx += 'title: "Components Index"\n'
        idx += "type: index\n"
        idx += "tags: [component, index]\n"
        idx += "---\n\n"
        idx += "# Component Areas\n\n"
        idx += f"{len(areas)} top-level component areas.\n\n"
        idx += "| Area | Files |\n|---|---|\n"
        for area in areas:
            cnt = len(list(area.rglob("*.tsx")))
            idx += f"| [[Components/{area.name}|{area.name}]] | {cnt} |\n"
        self._put("Components/_Index.md", idx)

    def _gen_component_area(self, area: Path, files: list[Path]) -> None:
        body = "---\n"
        body += f'title: "{area.name}"\n'
        body += "type: component-area\n"
        body += f"tags: [component, area, {area.name.lower()}]\n"
        body += f"files: {len(files)}\n"
        body += "---\n\n"
        body += f"# Components / {area.name}\n\n"
        body += f"**File count:** {len(files)}\n\n"
        body += "## Files\n\n"
        for f in files:
            stem = f.stem
            rel = f.relative_to(self.root).as_posix()
            body += f"- `{stem}` — `{rel}`\n"
        body += "\n## Related\n\n- [[Components/_Index]]\n- [[Arquitectura-Geral]]\n"
        self._put(f"Components/{area.name}.md", body)

    def sync_edge_functions(self) -> None:
        src_dir = self.root / "supabase" / "functions"
        if not src_dir.exists():
            return
        deployed = ["drive-storage", "send-otp", "verify-otp", "verify-session"]
        for name in deployed:
            local = src_dir / name / "index.ts"
            self._gen_edge_function(name, local.exists())

        idx = "---\n"
        idx += 'title: "Edge Functions Index"\n'
        idx += "type: index\n"
        idx += "tags: [supabase, edge-function, index]\n"
        idx += "---\n\n"
        idx += "# Supabase Edge Functions\n\n"
        idx += f"{len(deployed)} active edge functions.\n\n"
        idx += "| Function |\n|---|\n"
        for name in deployed:
            idx += f"| [[Edge-Functions/{name}|{name}]] |\n"
        self._put("Edge-Functions/_Index.md", idx)

    def _gen_edge_function(self, name: str, has_local: bool) -> None:
        body = "---\n"
        body += f'title: "{name}"\n'
        body += "type: edge-function\n"
        body += "tags: [supabase, edge-function, deno]\n"
        body += f"local: {'true' if has_local else 'false'}\n"
        body += "---\n\n"
        body += f"# `{name}` (Edge Function)\n\n"
        if has_local:
            body += f"## Source\n\n`supabase/functions/{name}/index.ts`\n\n"
        else:
            body += "## Source\n\n*Deployed only — no local source in repo.*\n\n"
        body += f"## URL\n\n`POST https://ctsuupvmmyjlrtjnxagv.supabase.co/functions/v1/{name}`\n\n"
        body += "## Related\n\n- [[Edge-Functions/_Index]]\n"
        self._put(f"Edge-Functions/{name}.md", body)

    def sync_database(self) -> None:
        """Sync database notes from Supabase schema. Read-only stub: emits a placeholder if schema cache absent."""
        cache = self.root / ".kromi-doc-schema.json"
        if not cache.exists():
            print("  [!] Database sync requires .kromi-doc-schema.json (run via MCP separately)")
            return
        import json

        schema = json.loads(cache.read_text(encoding="utf-8"))
        for table_name, columns in schema.items():
            self._gen_database_table(table_name, columns)

        # Index
        idx = "---\n"
        idx += 'title: "Database Index"\n'
        idx += "type: index\n"
        idx += "tags: [supabase, database, index]\n"
        idx += "---\n\n"
        idx += "# Database Tables\n\n"
        idx += f"{len(schema)} tables in `public` schema.\n\n"
        idx += "| Table | Columns |\n|---|---|\n"
        for t, cols in sorted(schema.items()):
            idx += f"| [[Database/{t}]] | {len(cols)} |\n"
        self._put("Database/_Index.md", idx)

    def _gen_database_table(self, table: str, columns: list[dict[str, Any]]) -> None:
        body = "---\n"
        body += f'title: "{table}"\n'
        body += "type: table\n"
        body += "tags: [supabase, database]\n"
        body += f"columns: {len(columns)}\n"
        body += "---\n\n"
        body += f"# `{table}`\n\n"
        body += "## Columns\n\n"
        body += "| Column | Type | Nullable | Default |\n|---|---|---|---|\n"
        for col in columns:
            nullable = "✓" if col.get("is_nullable") == "YES" else "✗"
            default = col.get("column_default") or ""
            if default and len(default) > 30:
                default = default[:27] + "..."
            body += f"| `{col['column_name']}` | {col['data_type']} | {nullable} | `{default}` |\n"
        body += f"\n**Total columns:** {len(columns)}\n\n"
        body += "## Related\n\n- [[Database/_Index]]\n- [[Supabase-Schema]]\n"
        self._put(f"Database/{table}.md", body)
