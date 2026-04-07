"""Create a new note from a template."""
from __future__ import annotations

from datetime import date
from pathlib import Path

from kromi_doc.obsidian import ObsidianClient

# Templates live next to the package, in tools/kromi-doc/templates/
TEMPLATE_DIR = Path(__file__).resolve().parent.parent / "templates"


def render_template(name: str, title: str, extra: dict[str, str] | None = None) -> str | None:
    src = TEMPLATE_DIR / f"{name}.md"
    if not src.exists():
        print(f"[!] Template not found: {src}")
        return None
    text = src.read_text(encoding="utf-8")
    today = date.today().isoformat()
    vars = {
        "title": title,
        "TITLE": title,
        "date": today,
        "today": today,
    }
    if extra:
        vars.update(extra)
    for k, v in vars.items():
        text = text.replace("{{" + k + "}}", v)
    return text


def create_from_template(
    template_name: str,
    title: str,
    output_path: str,
    client: ObsidianClient,
    append: bool = False,
    extra: dict[str, str] | None = None,
) -> bool:
    content = render_template(template_name, title, extra)
    if content is None:
        return False

    if append:
        existing = client.get(output_path)
        if existing:
            content = existing.rstrip() + "\n\n" + content
    if client.put(output_path, content):
        print(f"[OK] Wrote {output_path}")
        return True
    print(f"[!] Failed to write {output_path}")
    return False
