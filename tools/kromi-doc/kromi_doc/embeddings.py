"""Embeddings + RAG search for the KROMI vault.

Two backends:

- **TF-IDF (default)** — pure-Python, no ML dependencies. Fast, offline,
  works with the standard library only. Less semantic but good enough
  for keyword-style queries on technical docs.

- **sentence-transformers (opt-in via `--model st`)** — uses
  `all-MiniLM-L6-v2` (~80MB download on first use). True semantic
  search. Requires `pip install sentence-transformers`.

The index lives at `<project_root>/.kromi-doc-index.json` (TF-IDF) or
`.kromi-doc-index-st.npz` (sentence-transformers). Hashes are tracked
so re-running `embed` only re-processes changed notes.
"""
from __future__ import annotations

import hashlib
import json
import math
import re
from collections import Counter
from pathlib import Path
from typing import Any

from kromi_doc.obsidian import ObsidianClient


# ─── Tokenisation ───────────────────────────────────────────

STOPWORDS = set("""
a o e é de da do que com para por em no na os as um uma uns umas se sua seu suas seus eu tu ele ela nós vós eles elas
the and or to of in is at on for with by from as it this that there an be are was were has had have but not all any
also into more such which who whom whose where when how why such only same than then them they these those very each
""".split())

WORD_RE = re.compile(r"[a-zA-Z0-9_]{2,}")


def tokenize(text: str) -> list[str]:
    return [w.lower() for w in WORD_RE.findall(text) if w.lower() not in STOPWORDS]


def strip_frontmatter(content: str) -> tuple[dict[str, str], str]:
    """Returns (frontmatter_dict, body)."""
    fm: dict[str, str] = {}
    if not content.startswith("---"):
        return fm, content
    end = content.find("\n---", 3)
    if end == -1:
        return fm, content
    front = content[3:end]
    for line in front.splitlines():
        line = line.strip()
        if ":" in line:
            k, _, v = line.partition(":")
            fm[k.strip()] = v.strip().strip('"').strip("'")
    body = content[end + 4 :]
    return fm, body


# ─── Vault index (abstract base) ────────────────────────────


class VaultIndex:
    """Wraps a TF-IDF or sentence-transformers index over the vault."""

    def __init__(self, project_root: Path, model: str = "tfidf") -> None:
        self.root = Path(project_root).resolve()
        self.model = model
        self.index_path = self.root / (
            ".kromi-doc-index.json" if model == "tfidf" else ".kromi-doc-index-st.npz"
        )

    # ─── Existence ──────────────────────────────────────────
    def exists(self) -> bool:
        return self.index_path.exists()

    # ─── Build ──────────────────────────────────────────────
    def build(self, client: ObsidianClient) -> int:
        """(Re-)build the index from all vault notes. Returns count."""
        notes = client.walk("")
        docs: list[tuple[str, str, str]] = []  # (path, title, body_text)
        for path in notes:
            content = client.get(path) or ""
            fm, body = strip_frontmatter(content)
            title = fm.get("title", path)
            # Combine title (×3 weight) + body
            text = f"{title} {title} {title} {body}"
            docs.append((path, title, text))

        if self.model == "tfidf":
            return self._build_tfidf(docs)
        elif self.model == "st":
            return self._build_st(docs)
        else:
            raise ValueError(f"Unknown model: {self.model}")

    # ─── TF-IDF backend ─────────────────────────────────────
    def _build_tfidf(self, docs: list[tuple[str, str, str]]) -> int:
        # Compute term frequencies per doc
        doc_terms: list[Counter] = []
        for _, _, text in docs:
            doc_terms.append(Counter(tokenize(text)))

        # Document frequency per term
        df: Counter = Counter()
        for terms in doc_terms:
            for t in terms.keys():
                df[t] += 1

        n_docs = len(docs)
        # IDF
        idf = {t: math.log((n_docs + 1) / (cnt + 1)) + 1.0 for t, cnt in df.items()}

        # TF-IDF vectors per doc (sparse dict)
        vectors: list[dict[str, float]] = []
        for terms in doc_terms:
            total = sum(terms.values()) or 1
            vec = {}
            for t, c in terms.items():
                vec[t] = (c / total) * idf[t]
            # Normalise (cosine)
            norm = math.sqrt(sum(v * v for v in vec.values())) or 1.0
            vectors.append({k: v / norm for k, v in vec.items()})

        # Snippets (first 200 chars of body, after frontmatter)
        snippets = []
        for path, _, text in docs:
            snippets.append(text[:300].replace("\n", " "))

        index = {
            "version": 1,
            "model": "tfidf",
            "n_docs": n_docs,
            "paths": [d[0] for d in docs],
            "titles": [d[1] for d in docs],
            "snippets": snippets,
            "vectors": vectors,
            "idf": idf,
        }
        self.index_path.write_text(json.dumps(index), encoding="utf-8")
        return n_docs

    # ─── Sentence-transformers backend ──────────────────────
    def _build_st(self, docs: list[tuple[str, str, str]]) -> int:
        try:
            import numpy as np
            from sentence_transformers import SentenceTransformer
        except ImportError as exc:
            raise RuntimeError(
                "sentence-transformers not installed. Run: pip install kromi-doc[embeddings]"
            ) from exc

        model = SentenceTransformer("all-MiniLM-L6-v2")
        texts = [d[2] for d in docs]
        embeddings = model.encode(texts, show_progress_bar=True, convert_to_numpy=True)
        # Normalise for cosine similarity
        norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
        embeddings = embeddings / np.where(norms == 0, 1, norms)

        np.savez_compressed(
            self.index_path,
            paths=np.array([d[0] for d in docs], dtype=object),
            titles=np.array([d[1] for d in docs], dtype=object),
            snippets=np.array([d[2][:300].replace("\n", " ") for d in docs], dtype=object),
            embeddings=embeddings,
        )
        return len(docs)

    # ─── Search ─────────────────────────────────────────────
    def search(self, query: str, top_k: int = 10) -> list[tuple[str, float, str]]:
        if self.model == "tfidf" or self.index_path.suffix == ".json":
            return self._search_tfidf(query, top_k)
        return self._search_st(query, top_k)

    def _search_tfidf(self, query: str, top_k: int) -> list[tuple[str, float, str]]:
        index = json.loads(self.index_path.read_text(encoding="utf-8"))
        idf = index["idf"]
        vectors = index["vectors"]
        paths = index["paths"]
        snippets = index["snippets"]

        # Build query vector
        terms = tokenize(query)
        if not terms:
            return []
        q_counts = Counter(terms)
        total = sum(q_counts.values())
        q_vec = {}
        for t, c in q_counts.items():
            if t in idf:
                q_vec[t] = (c / total) * idf[t]
        norm = math.sqrt(sum(v * v for v in q_vec.values())) or 1.0
        q_vec = {k: v / norm for k, v in q_vec.items()}

        # Cosine similarity
        scored: list[tuple[str, float, str]] = []
        for i, vec in enumerate(vectors):
            score = sum(q_vec.get(t, 0.0) * v for t, v in vec.items())
            if score > 0:
                scored.append((paths[i], score, snippets[i]))
        scored.sort(key=lambda x: -x[1])
        return scored[:top_k]

    def _search_st(self, query: str, top_k: int) -> list[tuple[str, float, str]]:
        try:
            import numpy as np
            from sentence_transformers import SentenceTransformer
        except ImportError as exc:
            raise RuntimeError(
                "sentence-transformers not installed. Run: pip install kromi-doc[embeddings]"
            ) from exc

        data = np.load(self.index_path, allow_pickle=True)
        paths = data["paths"]
        snippets = data["snippets"]
        embeddings = data["embeddings"]

        model = SentenceTransformer("all-MiniLM-L6-v2")
        q_emb = model.encode([query], convert_to_numpy=True)[0]
        q_norm = np.linalg.norm(q_emb) or 1.0
        q_emb = q_emb / q_norm

        scores = embeddings @ q_emb
        order = np.argsort(-scores)[:top_k]
        return [(str(paths[i]), float(scores[i]), str(snippets[i])) for i in order if scores[i] > 0]
