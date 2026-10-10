"""Unicode-aware text utilities (English + Arabic). No model required."""

from __future__ import annotations

import re
import unicodedata

EN_STOP = {
    "a",
    "about",
    "above",
    "after",
    "again",
    "against",
    "all",
    "also",
    "am",
    "an",
    "and",
    "any",
    "are",
    "aren't",
    "as",
    "at",
    "be",
    "because",
    "been",
    "before",
    "being",
    "below",
    "between",
    "both",
    "but",
    "by",
    "can",
    "can't",
    "cannot",
    "could",
    "couldn't",
    "did",
    "didn't",
    "do",
    "does",
    "doesn't",
    "doing",
    "don't",
    "down",
    "during",
    "each",
    "few",
    "for",
    "from",
    "further",
    "had",
    "hadn't",
    "has",
    "hasn't",
    "have",
    "haven't",
    "having",
    "he",
    "her",
    "here",
    "hers",
    "herself",
    "him",
    "himself",
    "his",
    "how",
    "i",
    "if",
    "in",
    "into",
    "is",
    "isn't",
    "it",
    "it's",
    "its",
    "itself",
    "just",
    "me",
    "more",
    "most",
    "my",
    "myself",
    "no",
    "nor",
    "not",
    "now",
    "of",
    "off",
    "on",
    "once",
    "only",
    "or",
    "other",
    "our",
    "ours",
    "ourselves",
    "out",
    "over",
    "own",
    "same",
    "she",
    "should",
    "shouldn't",
    "so",
    "some",
    "such",
    "than",
    "that",
    "the",
    "their",
    "theirs",
    "them",
    "themselves",
    "then",
    "there",
    "these",
    "they",
    "this",
    "those",
    "through",
    "to",
    "too",
    "under",
    "until",
    "up",
    "very",
    "was",
    "wasn't",
    "we",
    "were",
    "weren't",
    "what",
    "when",
    "where",
    "which",
    "while",
    "who",
    "whom",
    "why",
    "will",
    "with",
    "won't",
    "would",
    "wouldn't",
    "you",
    "your",
    "yours",
    "yourself",
    "yourselves",
    "really",
    "get",
    "got",
    "one",
    "like",
    "even",
    "still",
    "much",
    "many",
    "made",
    "make",
}
AR_STOP = {
    "في",
    "من",
    "على",
    "إلى",
    "عن",
    "مع",
    "هذا",
    "هذه",
    "ذلك",
    "تلك",
    "هو",
    "هي",
    "هم",
    "هن",
    "أن",
    "إن",
    "كان",
    "كانت",
    "يكون",
    "التي",
    "الذي",
    "الذين",
    "ما",
    "لا",
    "لم",
    "لن",
    "قد",
    "كل",
    "أو",
    "و",
    "ثم",
    "بعد",
    "قبل",
    "عند",
    "حتى",
    "هل",
    "كما",
    "لكن",
    "إذا",
    "أي",
    "أنا",
    "نحن",
    "أنت",
}
STOPWORDS = EN_STOP | AR_STOP
SK_STOPWORDS = sorted(
    w for w in STOPWORDS if re.fullmatch(r"[^\W\d_]{2,}", w)
)  # forms scikit-learn's tokenizer can actually produce

_TOKEN = re.compile(r"[^\W\d_]+(?:['’][^\W\d_]+)?", re.UNICODE)
_AR_DIACRITICS = re.compile(r"[ً-ْـ]")
_SENT = re.compile(r"(?<=[.!?؟])\s+(?=[A-Z؀-ۿ\"“(])")
_WS = re.compile(r"\s+")


def normalize(text: str) -> str:
    t = unicodedata.normalize("NFKC", str(text))
    t = _AR_DIACRITICS.sub("", t)
    t = t.replace("أ", "ا").replace("إ", "ا").replace("آ", "ا").replace("ى", "ي")
    return _WS.sub(" ", t).strip()


def tokens(text: str, *, drop_stop: bool = True) -> list[str]:
    toks = [t.lower() for t in _TOKEN.findall(normalize(text))]
    return [t for t in toks if len(t) > 1 and (not drop_stop or t not in STOPWORDS)]


def split_sentences(text: str) -> list[str]:
    parts = [p.strip() for p in _SENT.split(str(text).strip()) if p.strip()]
    return parts or [str(text).strip()]


def make_segments(text: str, split: str) -> list[str]:
    """Return the segments for one response. ``split='sentences'`` produces sentence-level units for long transcripts."""
    t = str(text).strip()
    if not t:
        return []
    if split == "sentences":
        parts = split_sentences(t)
        # very short sentences ("Late delivery again.", "Thanks for asking.") are merged into a neighbour so no text is lost and no filler-only segments appear
        merged: list[str] = []
        carry = ""
        for sent in parts:
            if len(sent.split()) < 4:
                if merged:
                    merged[-1] = f"{merged[-1]} {sent}"
                else:
                    carry = f"{carry} {sent}".strip()
                continue
            merged.append(f"{carry} {sent}".strip() if carry else sent)
            carry = ""
        return merged or [t]
    return [t]


def keyword_pattern(keyword: str) -> re.Pattern[str]:
    """Whole-word, case-insensitive, Unicode-safe match (a trailing * allows any suffix: 'deliver*')."""
    kw = normalize(keyword).lower().strip()
    wild = kw.endswith("*")
    core = re.escape(kw.rstrip("*"))
    suffix = r"[\w]*" if wild else ""
    return re.compile(rf"(?<![\w]){core}{suffix}(?![\w])", re.IGNORECASE | re.UNICODE)
