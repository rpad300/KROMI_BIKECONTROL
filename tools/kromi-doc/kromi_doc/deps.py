"""Service dependency graph generator.

Walks src/services/*.ts, parses internal imports, builds a graph,
emits a Mermaid diagram as an Obsidian note.
"""
from __future__ import annotations

import re
from collections import defaultdict
from pathlib import Path

from kromi_doc.obsidian import ObsidianClient

IMPORT_RE = re.compile(r"^import\s+(?:[^'\"]+from\s+)?['\"]([^'\"]+)['\"]", re.MULTILINE)


class DependencyGraph:
    def __init__(self, project_root: Path) -> None:
        self.root = Path(project_root).resolve()

    def _build_service_graph(self) -> dict[str, set[str]]:
        """Returns {service_name: {dependency_service_names}}"""
        services_dir = self.root / "src" / "services"
        graph: dict[str, set[str]] = defaultdict(set)
        if not services_dir.exists():
            return graph

        for p in services_dir.rglob("*.ts"):
            if not p.is_file():
                continue
            rel = p.relative_to(services_dir)
            if len(rel.parts) < 2:
                continue
            src_name = rel.with_suffix("").as_posix()
            try:
                content = p.read_text(encoding="utf-8")
            except Exception:
                continue

            for imp in IMPORT_RE.findall(content):
                if not imp.startswith("."):
                    continue
                # Resolve relative path
                resolved = (p.parent / imp).resolve()
                # Strip extension if any
                try:
                    rel_resolved = resolved.relative_to(services_dir)
                except ValueError:
                    continue  # outside services/
                tgt_name = rel_resolved.with_suffix("").as_posix()
                if tgt_name != src_name:
                    graph[src_name].add(tgt_name)

        return graph

    def _build_category_graph(self) -> dict[str, set[str]]:
        """Roll up service-level edges to category-level edges."""
        svc_graph = self._build_service_graph()
        cat_graph: dict[str, set[str]] = defaultdict(set)
        for src, deps in svc_graph.items():
            src_cat = src.split("/")[0]
            for d in deps:
                d_cat = d.split("/")[0]
                if src_cat != d_cat:
                    cat_graph[src_cat].add(d_cat)
        return cat_graph

    # ─── Mermaid output ─────────────────────────────────────

    def render_category_mermaid(self) -> str:
        cat_graph = self._build_category_graph()
        all_cats = sorted(set(cat_graph.keys()) | {dep for deps in cat_graph.values() for dep in deps})
        lines = ["```mermaid", "graph LR"]
        for cat in all_cats:
            label = cat.replace("-", "_")
            lines.append(f"    {label}[{cat}]")
        for src, deps in sorted(cat_graph.items()):
            for d in sorted(deps):
                lines.append(f"    {src.replace('-','_')} --> {d.replace('-','_')}")
        lines.append("```")
        return "\n".join(lines)

    def render_service_mermaid(self, category: str | None = None) -> str:
        svc_graph = self._build_service_graph()
        # Filter
        if category:
            svc_graph = {
                s: {d for d in deps if d.startswith(category + "/")}
                for s, deps in svc_graph.items()
                if s.startswith(category + "/")
            }
            svc_graph = {s: deps for s, deps in svc_graph.items() if s.startswith(category + "/")}

        # Get all nodes
        all_nodes = set(svc_graph.keys())
        for deps in svc_graph.values():
            all_nodes.update(deps)

        lines = ["```mermaid", "graph LR"]
        for node in sorted(all_nodes):
            label = node.replace("/", "_").replace("-", "_")
            display = node.split("/")[-1]
            lines.append(f"    {label}[{display}]")
        for src, deps in sorted(svc_graph.items()):
            src_label = src.replace("/", "_").replace("-", "_")
            for d in sorted(deps):
                d_label = d.replace("/", "_").replace("-", "_")
                lines.append(f"    {src_label} --> {d_label}")
        lines.append("```")
        return "\n".join(lines)

    def publish(self, client: ObsidianClient, category: str | None = None) -> int:
        """Publish the dependency graph note(s) to the vault."""
        n = 0
        if category:
            # Per-category graph only
            content = self._build_category_note(category)
            client.put(f"03-Architecture/Dependency-Graph-{category}.md", content)
            n += 1
        else:
            # Top-level graph
            content = self._build_main_note()
            client.put("03-Architecture/Dependency-Graph.md", content)
            n += 1
        return n

    def _build_main_note(self) -> str:
        cat_diagram = self.render_category_mermaid()
        svc_graph = self._build_service_graph()
        cat_graph = self._build_category_graph()

        # Stats
        n_services = len(svc_graph)
        n_categories = len({s.split("/")[0] for s in svc_graph})
        n_edges = sum(len(d) for d in svc_graph.values())
        n_cat_edges = sum(len(d) for d in cat_graph.values())

        lines = [
            "---",
            'title: "Service Dependency Graph"',
            "type: architecture",
            "tags: [architecture, dependencies, graph, services, mermaid]",
            "auto_generated: true",
            "tool: kromi-doc",
            "---",
            "",
            "# Service Dependency Graph",
            "",
            "> Generated by `kromi-doc deps`. Run again to refresh.",
            "",
            "## Stats",
            "",
            f"- **Services analysed:** {n_services}",
            f"- **Categories:** {n_categories}",
            f"- **Service-level edges:** {n_edges}",
            f"- **Category-level edges:** {n_cat_edges}",
            "",
            "## Category-level graph",
            "",
            "Coarse view: which service categories import from which others. This is the recommended starting point — the full service graph is too dense to read.",
            "",
            cat_diagram,
            "",
            "## Per-category service graphs",
            "",
            "Each category has its own detailed graph available:",
            "",
        ]
        for cat in sorted({s.split("/")[0] for s in svc_graph}):
            lines.append(f"- `{cat}` — run `kromi-doc deps --category {cat}` to generate")

        lines += [
            "",
            "## How to read",
            "",
            "An arrow `A --> B` means **A imports from B** at the file level. Categories are folder names under `src/services/`.",
            "",
            "The KROMI architecture follows a layered approach:",
            "",
            "1. **`bluetooth/`** is at the bottom — it talks to hardware",
            "2. **`storage/`, `auth/`, `rbac/`, `sync/`** are foundation services",
            "3. **`intelligence/`, `motor/`, `autoAssist/`** consume sensor data and produce decisions",
            "4. **`maintenance/`, `routes/`, `learning/`** are feature-level services",
            "",
            "Cycles in the graph indicate **bad dependencies** that should be refactored.",
            "",
            "## Related",
            "",
            "- [[Services/_Index]]",
            "- [[Arquitectura-Geral]]",
            "- [[Stores-Data-Flow]]",
            "- [[MOC]]",
        ]

        return "\n".join(lines)

    def _build_category_note(self, category: str) -> str:
        diagram = self.render_service_mermaid(category=category)
        return "\n".join(
            [
                "---",
                f'title: "Dependency Graph — {category}"',
                "type: architecture",
                f"tags: [architecture, dependencies, graph, {category}]",
                "auto_generated: true",
                "tool: kromi-doc",
                "---",
                "",
                f"# Dependency Graph — `{category}`",
                "",
                "> Generated by `kromi-doc deps --category {category}`.",
                "",
                "## Internal dependencies",
                "",
                diagram,
                "",
                "## Related",
                "",
                f"- [[Services/{category}/_Index]]",
                "- [[Dependency-Graph]]",
                "- [[MOC]]",
            ]
        )
