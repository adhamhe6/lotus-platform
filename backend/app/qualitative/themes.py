"""Theme detection: cluster segment embeddings, label with distinguishing terms, pick representative quotes.

All counts/ranks are computed; a theme is a *suggestion* the researcher can rename, merge or delete.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from sklearn.cluster import KMeans
from sklearn.feature_extraction.text import CountVectorizer
from sklearn.metrics import silhouette_score

from app.analysis.base import SEED
from app.core.exceptions import InsufficientDataError
from app.qualitative.text import SK_STOPWORDS, normalize

MIN_SEGMENTS = 10
MIN_THEME_SIZE = 3


@dataclass
class DetectedTheme:
    index: int
    segment_idx: list[int]
    scores: list[float]
    terms: list[str]
    name: str
    representatives: list[int]
    size: int = 0
    extra: dict = field(default_factory=dict)


@dataclass
class ThemeResult:
    themes: list[DetectedTheme]
    k: int
    silhouette: float | None
    unassigned: list[int]
    candidates: list[dict]


def _choose_k(vectors: np.ndarray, k: int | None) -> tuple[int, list[dict]]:
    """Fixed k, or the *smallest* k whose silhouette is within 15% of the best (silhouette alone keeps rewarding ever-finer splits)."""
    n = len(vectors)
    distinct = len(np.unique(np.round(vectors, 6), axis=0))
    if distinct < 2:
        raise InsufficientDataError("All responses are (nearly) identical, so no themes can be separated.")
    if k is not None:
        return max(2, min(k, n // MIN_THEME_SIZE, distinct)), []
    kmax = max(2, min(8, n // 12, distinct))
    cands = []
    for kk in range(2, kmax + 1):
        km = KMeans(n_clusters=kk, n_init=10, random_state=SEED).fit(vectors)
        sil = float(silhouette_score(vectors, km.labels_)) if len(set(km.labels_)) > 1 else -1.0
        cands.append({"k": kk, "silhouette": sil})
    best = max(c["silhouette"] for c in cands)
    floor = best * 0.85 if best > 0 else best
    chosen = min((c for c in cands if c["silhouette"] >= floor), key=lambda c: c["k"])
    return chosen["k"], cands


def c_tfidf_terms(texts: list[str], labels: np.ndarray, n_terms: int = 6) -> dict[int, list[str]]:
    """Class-based TF-IDF: terms present in many responses of a cluster and rare elsewhere (unigrams preferred, bigrams when clearly better)."""
    cv = CountVectorizer(
        stop_words=SK_STOPWORDS,
        token_pattern=r"(?u)\b[^\W\d_]{3,}\b",
        ngram_range=(1, 2),
        min_df=2 if len(texts) >= 30 else 1,
        lowercase=True,
        binary=True,
    )
    docs = [normalize(t).lower() for t in texts]
    classes = sorted(int(c) for c in set(labels))
    try:
        x = cv.fit_transform(docs)
    except ValueError:
        return {c: [] for c in classes}
    vocab = np.array(cv.get_feature_names_out())
    n_docs = len(docs)
    df_all = np.asarray(x.sum(axis=0)).ravel().astype(float)
    out = {}
    for c in classes:
        mask = labels == c
        size = int(mask.sum())
        df_c = np.asarray(x[mask].sum(axis=0)).ravel().astype(float)
        cover = df_c / max(size, 1)
        idf = np.log(1 + n_docs / np.maximum(df_all, 1))
        score = cover * idf * (df_c / np.maximum(df_all, 1))  # frequent here, rare elsewhere
        boring = df_all / n_docs > 0.45
        score[(df_c < max(2, 0.08 * size)) | boring] = 0
        is_bi = np.array([" " in t for t in vocab])
        score = np.where(is_bi, score * 0.8, score)  # bigrams must be clearly better to win
        picked: list[str] = []
        for j in np.argsort(-score):
            if score[j] <= 0:
                break
            term = str(vocab[j])
            if any(term in p or p in term or set(term.split()) & set(p.split()) for p in picked):
                continue
            picked.append(term)
            if len(picked) == n_terms:
                break
        out[c] = picked
    return out


def detect_themes(texts: list[str], vectors: np.ndarray, k: int | None = None) -> ThemeResult:
    n = len(texts)
    if n < MIN_SEGMENTS:
        raise InsufficientDataError(
            f"Only {n} text segments are available; at least {MIN_SEGMENTS} are needed to detect themes."
        )
    chosen, cands = _choose_k(vectors, k)
    km = KMeans(n_clusters=chosen, n_init=10, random_state=SEED).fit(vectors)
    labels = km.labels_
    sil = float(silhouette_score(vectors, labels)) if len(set(labels)) > 1 else None
    terms = c_tfidf_terms(texts, labels)
    themes, unassigned = [], []
    order = sorted(range(chosen), key=lambda c: -int((labels == c).sum()))
    for pos, c in enumerate(order):
        idx = np.where(labels == c)[0]
        if len(idx) < MIN_THEME_SIZE:
            unassigned.extend(int(i) for i in idx)
            continue
        centroid = km.cluster_centers_[c]
        centroid = centroid / (np.linalg.norm(centroid) or 1)
        sims = vectors[idx] @ centroid
        rank = np.argsort(-sims)
        t = terms.get(c, [])
        name = " / ".join(w.title() for w in t[:3]) or f"Theme {pos + 1}"
        themes.append(
            DetectedTheme(
                index=pos,
                segment_idx=[int(idx[r]) for r in rank],
                scores=[float(sims[r]) for r in rank],
                terms=t,
                name=name,
                representatives=[int(idx[r]) for r in rank[:3]],
                size=len(idx),
            )
        )
    return ThemeResult(themes=themes, k=chosen, silhouette=sil, unassigned=unassigned, candidates=cands)


def top_terms(texts: list[str], n: int = 25) -> list[dict]:
    cv = CountVectorizer(
        stop_words=SK_STOPWORDS,
        token_pattern=r"(?u)\b[^\W\d_]{3,}\b",
        lowercase=True,
        ngram_range=(1, 2),
        min_df=2 if len(texts) > 20 else 1,
    )
    try:
        x = cv.fit_transform([normalize(t).lower() for t in texts])
    except ValueError:
        return []
    docfreq = np.asarray((x > 0).sum(axis=0)).ravel()
    counts = np.asarray(x.sum(axis=0)).ravel()
    vocab = cv.get_feature_names_out()
    picked: list[dict] = []
    for j in np.argsort(-docfreq):
        term = str(vocab[j])
        if any(term in p["term"] for p in picked if p["term"] != term and docfreq[j] <= p["responses"]):
            continue
        picked.append(
            {
                "term": term,
                "responses": int(docfreq[j]),
                "occurrences": int(counts[j]),
                "pct": round(float(docfreq[j]) / len(texts) * 100, 2),
            }
        )
        if len(picked) >= n:
            break
    return picked
