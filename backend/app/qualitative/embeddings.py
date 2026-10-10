"""Replaceable embedding providers.

* ``tfidf-lsa`` (default): TF-IDF → truncated SVD (latent semantic analysis) → L2 norm. Offline, deterministic, no model download.
  It is *fitted per column*, so its vector space is only comparable within the corpus it was fitted on (the fitted model is persisted
  so that queries can be embedded into the same space).
* ``sentence-transformers`` (optional ``pip install .[nlp]``): multilingual transformer embeddings, comparable across corpora.
"""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any, Protocol

import joblib
import numpy as np
from sklearn.decomposition import TruncatedSVD
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.preprocessing import normalize as l2

from app.analysis.base import SEED
from app.core.exceptions import InsufficientDataError, ServiceUnavailable
from app.qualitative.text import SK_STOPWORDS, normalize


class Embedder(Protocol):
    model_id: str

    def fit_transform(self, texts: list[str]) -> np.ndarray: ...
    def transform(self, texts: list[str]) -> np.ndarray: ...
    def save(self, path: Path) -> None: ...


class TfidfLsaEmbedder:
    def __init__(self, n_components: int = 40):
        self.n_components = n_components
        self.vectorizer: TfidfVectorizer | None = None
        self.svd: TruncatedSVD | None = None
        self.model_id = "tfidf-lsa-v1"

    def fit_transform(self, texts: list[str]) -> np.ndarray:
        docs = [normalize(t).lower() for t in texts]
        n = len(docs)
        if n < 5:
            raise InsufficientDataError("At least 5 text segments are needed to build a semantic model.")
        self.vectorizer = TfidfVectorizer(
            sublinear_tf=True,
            ngram_range=(1, 2),
            min_df=2 if n >= 20 else 1,
            max_df=0.85,
            stop_words=SK_STOPWORDS,
            token_pattern=r"(?u)\b[^\W\d_]{2,}\b",
            strip_accents=None,
            lowercase=True,
        )
        x = self.vectorizer.fit_transform(docs)
        if x.shape[1] < 3:
            raise InsufficientDataError(
                "The text is too repetitive or too short to extract meaningful vocabulary."
            )
        k = max(2, min(self.n_components, x.shape[1] - 1, n - 1, max(8, n // 4)))
        self.svd = TruncatedSVD(n_components=k, random_state=SEED, algorithm="randomized", n_iter=7)
        z = self.svd.fit_transform(x)
        self.model_id = f"tfidf-lsa-v1:k{k}:v{x.shape[1]}"
        return l2(z)

    def transform(self, texts: list[str]) -> np.ndarray:
        assert self.vectorizer is not None and self.svd is not None, "model not fitted"
        return l2(self.svd.transform(self.vectorizer.transform([normalize(t).lower() for t in texts])))

    def save(self, path: Path) -> None:
        joblib.dump(
            {
                "kind": "tfidf-lsa",
                "vectorizer": self.vectorizer,
                "svd": self.svd,
                "model_id": self.model_id,
                "n_components": self.n_components,
            },
            path,
            compress=3,
        )

    @classmethod
    def load(cls, path: Path) -> TfidfLsaEmbedder:
        d: dict[str, Any] = joblib.load(path)
        e = cls(d["n_components"])
        e.vectorizer, e.svd, e.model_id = d["vectorizer"], d["svd"], d["model_id"]
        return e


class SentenceTransformerEmbedder:
    def __init__(self, name: str):
        try:
            from sentence_transformers import SentenceTransformer
        except ImportError as e:
            raise ServiceUnavailable(
                "EMBEDDING_PROVIDER=sentence-transformers requires `pip install .[nlp]`.",
                code="EMBEDDING_PROVIDER_UNAVAILABLE",
            ) from e
        try:
            self.model = SentenceTransformer(name)
        except Exception as e:  # model download / load failure
            raise ServiceUnavailable(
                f"The embedding model '{name}' could not be loaded.", code="EMBEDDING_MODEL_UNAVAILABLE"
            ) from e
        self.name = name
        self.model_id = f"sentence-transformers:{name}"

    def fit_transform(self, texts: list[str]) -> np.ndarray:
        return self.transform(texts)

    def transform(self, texts: list[str]) -> np.ndarray:
        return l2(np.asarray(self.model.encode(texts, batch_size=32, show_progress_bar=False)))

    def save(self, path: Path) -> None:
        joblib.dump({"kind": "st", "name": self.name}, path)


def load_embedder(path: Path, provider: str, model_name: str) -> Embedder:
    if provider == "sentence-transformers":
        return SentenceTransformerEmbedder(model_name)
    return TfidfLsaEmbedder.load(path)


def new_embedder(provider: str, model_name: str) -> Embedder:
    return (
        SentenceTransformerEmbedder(model_name) if provider == "sentence-transformers" else TfidfLsaEmbedder()
    )


def corpus_fingerprint(texts: list[str]) -> str:
    h = hashlib.sha256()
    for t in texts:
        h.update(t.encode())
        h.update(b"\x00")
    return h.hexdigest()[:16]
