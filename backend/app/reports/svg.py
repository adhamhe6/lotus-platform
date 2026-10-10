"""Server-side SVG rendering of ChartSpec (used by exported reports — no browser or JS needed)."""

from __future__ import annotations

import math
from html import escape
from typing import Any

PALETTE = ["#1d6f6a", "#c2693b", "#2b4c8c", "#8a6bb0", "#b8963a", "#5c8a5a", "#a34a6a", "#4f8fb0"]
INK, MUTED, GRID = "#17313b", "#5d7078", "#e3e8e6"
W, H = 640, 340
ML, MR, MT, MB = 62, 18, 14, 52


def _num(v: float) -> str:
    if abs(v) >= 1000 or (v != 0 and abs(v) < 0.01):
        return f"{v:.3g}"
    return f"{v:.2f}".rstrip("0").rstrip(".")


def _ticks(lo: float, hi: float, n: int = 5) -> list[float]:
    if hi == lo:
        return [lo]
    step = (hi - lo) / n
    mag = 10 ** math.floor(math.log10(step))
    step = min((s * mag for s in (1, 2, 2.5, 5, 10) if s * mag >= step), default=step)
    start = math.floor(lo / step) * step
    out, t = [], start
    while t <= hi + step * 0.001:
        if t >= lo - step * 0.001:
            out.append(round(t, 10))
        t += step
    return out


class _Plot:
    def __init__(
        self, xmin: float, xmax: float, ymin: float, ymax: float, x_label: str | None, y_label: str | None
    ):
        self.x0, self.x1, self.y0, self.y1 = xmin, xmax, ymin, ymax
        self.xl, self.yl = x_label, y_label
        self.out: list[str] = []

    def sx(self, x: float) -> float:
        return ML + (x - self.x0) / ((self.x1 - self.x0) or 1) * (W - ML - MR)

    def sy(self, y: float) -> float:
        return H - MB - (y - self.y0) / ((self.y1 - self.y0) or 1) * (H - MB - MT)

    def frame(self, xticks: list[float] | None = None, grid_y: bool = True) -> None:
        for t in _ticks(self.y0, self.y1):
            y = self.sy(t)
            if grid_y:
                self.out.append(f'<line x1="{ML}" x2="{W - MR}" y1="{y:.1f}" y2="{y:.1f}" stroke="{GRID}"/>')
            self.out.append(
                f'<text x="{ML - 6}" y="{y + 3:.1f}" text-anchor="end" font-size="10" fill="{MUTED}">{_num(t)}</text>'
            )
        for t in xticks or []:
            self.out.append(
                f'<text x="{self.sx(t):.1f}" y="{H - MB + 14}" text-anchor="middle" font-size="10" fill="{MUTED}">{_num(t)}</text>'
            )
        self.out.append(
            f'<line x1="{ML}" x2="{W - MR}" y1="{H - MB}" y2="{H - MB}" stroke="{MUTED}"/><line x1="{ML}" x2="{ML}" y1="{MT}" y2="{H - MB}" stroke="{MUTED}"/>'
        )
        if self.xl:
            self.out.append(
                f'<text x="{(ML + W - MR) / 2}" y="{H - 8}" text-anchor="middle" font-size="11" fill="{INK}">{escape(self.xl)}</text>'
            )
        if self.yl:
            self.out.append(
                f'<text transform="translate(14,{(MT + H - MB) / 2}) rotate(-90)" text-anchor="middle" font-size="11" fill="{INK}">{escape(self.yl)}</text>'
            )


def _wrap(body: list[str], desc: str, title: str, h: int = H) -> str:
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {h}" role="img" aria-label="{escape(title)}" style="max-width:100%;height:auto;font-family:system-ui,sans-serif">'
        f"<title>{escape(title)}</title><desc>{escape(desc)}</desc>{''.join(body)}</svg>"
    )


def _short(s: str, n: int = 14) -> str:
    return s if len(s) <= n else s[: n - 1] + "…"


def render(spec: dict[str, Any]) -> str:
    k, d = spec["kind"], spec.get("data", {})
    fn = {
        "bar": _bar,
        "hbar": _hbar,
        "stacked_bar": _stacked,
        "line": _line,
        "scatter": _scatter,
        "histogram": _hist,
        "box": _box,
        "heatmap": _heat,
        "donut": _donut,
        "coef": _coef,
        "roc": _roc,
    }.get(k)
    if fn is None:
        return ""
    try:
        return fn(spec, d)
    except Exception:  # a chart must never break a whole report
        return f'<p class="muted">Chart “{escape(spec.get("title", ""))}” could not be rendered.</p>'


def _bar(spec: dict, d: dict) -> str:
    cats, s = d["categories"], d["series"][0]
    vals = [v or 0 for v in s["values"]]
    errs = s.get("errors") or []
    hi = max([*vals, *[e[1] for e in errs if e and e[1] is not None]] or [1])
    p = _Plot(0, len(cats), min(0, min(vals + [0])), hi * 1.08 or 1, spec.get("x_label"), spec.get("y_label"))
    p.frame()
    bw = (W - ML - MR) / len(cats) * 0.62
    for i, (c, v) in enumerate(zip(cats, vals, strict=True)):
        cx = p.sx(i + 0.5)
        y0, y1 = p.sy(0), p.sy(v)
        p.out.append(
            f'<rect x="{cx - bw / 2:.1f}" y="{min(y0, y1):.1f}" width="{bw:.1f}" height="{abs(y0 - y1):.1f}" rx="2" fill="{PALETTE[0]}"/>'
        )
        if i < len(errs) and errs[i] and errs[i][0] is not None:
            p.out.append(
                f'<line x1="{cx:.1f}" x2="{cx:.1f}" y1="{p.sy(errs[i][0]):.1f}" y2="{p.sy(errs[i][1]):.1f}" stroke="{INK}" stroke-width="1.5"/>'
            )
        p.out.append(
            f'<text x="{cx:.1f}" y="{p.sy(max(v, errs[i][1] if i < len(errs) and errs[i] and errs[i][1] is not None else v)) - 5:.1f}" text-anchor="middle" font-size="10" fill="{INK}">{_num(v)}</text>'
        )
        p.out.append(
            f'<text x="{cx:.1f}" y="{H - MB + 14}" text-anchor="middle" font-size="10" fill="{MUTED}">{escape(_short(c, 12))}</text>'
        )
    return _wrap(p.out, spec.get("description", ""), spec["title"])


def _hbar(spec: dict, d: dict) -> str:
    cats, vals = d["categories"], [v or 0 for v in d["series"][0]["values"]]
    n = len(cats)
    h = max(H, 70 + n * 26)
    hi = max(vals + [1]) * 1.12
    out = []
    left = 150
    for i, (c, v) in enumerate(zip(cats, vals, strict=True)):
        y = 20 + i * 26
        w = (W - left - 50) * v / hi
        out.append(
            f'<text x="{left - 8}" y="{y + 13}" text-anchor="end" font-size="11" fill="{INK}">{escape(_short(c, 22))}</text><rect x="{left}" y="{y}" width="{w:.1f}" height="18" rx="2" fill="{PALETTE[0]}"/>'
            f'<text x="{left + w + 5:.1f}" y="{y + 13}" font-size="10" fill="{MUTED}">{_num(v)}</text>'
        )
    return _wrap(out, spec.get("description", ""), spec["title"], h)


def _stacked(spec: dict, d: dict) -> str:
    cats, series = d["categories"], d["series"]
    p = _Plot(0, len(cats), 0, 100, spec.get("x_label"), spec.get("y_label"))
    p.frame()
    bw = (W - ML - MR) / len(cats) * 0.62
    for i, c in enumerate(cats):
        acc = 0.0
        cx = p.sx(i + 0.5)
        for j, s in enumerate(series):
            v = s["values"][i] or 0
            p.out.append(
                f'<rect x="{cx - bw / 2:.1f}" y="{p.sy(acc + v):.1f}" width="{bw:.1f}" height="{p.sy(acc) - p.sy(acc + v):.1f}" fill="{PALETTE[j % len(PALETTE)]}"/>'
            )
            acc += v
        p.out.append(
            f'<text x="{cx:.1f}" y="{H - MB + 14}" text-anchor="middle" font-size="10" fill="{MUTED}">{escape(_short(c, 12))}</text>'
        )
    for j, s in enumerate(series[:8]):
        p.out.append(
            f'<rect x="{ML + j * 90}" y="{H - 22}" width="10" height="10" fill="{PALETTE[j % len(PALETTE)]}"/><text x="{ML + j * 90 + 14}" y="{H - 13}" font-size="10" fill="{INK}">{escape(_short(s["name"], 10))}</text>'
        )
    return _wrap(p.out, spec.get("description", ""), spec["title"])


def _line(spec: dict, d: dict) -> str:
    xs, series = d["x"], d["series"]
    allv = [v for s in series for v in s["values"] if v is not None]
    if not allv:
        return ""
    lo, hi = min(allv), max(allv)
    pad = (hi - lo) * 0.08 or 1
    p = _Plot(0, max(len(xs) - 1, 1), lo - pad, hi + pad, spec.get("x_label"), spec.get("y_label"))
    p.frame()
    step = max(1, len(xs) // 8)
    for i in range(0, len(xs), step):
        p.out.append(
            f'<text x="{p.sx(i):.1f}" y="{H - MB + 14}" text-anchor="middle" font-size="10" fill="{MUTED}">{escape(str(xs[i]))}</text>'
        )
    for j, s in enumerate(series):
        pts, seg = [], []
        for i, v in enumerate(s["values"]):
            if v is None:
                if seg:
                    pts.append(seg)
                seg = []
            else:
                seg.append(f"{p.sx(i):.1f},{p.sy(v):.1f}")
        if seg:
            pts.append(seg)
        dash = ' stroke-dasharray="5 4"' if s.get("dashed") else ""
        for sg in pts:
            p.out.append(
                f'<polyline points="{" ".join(sg)}" fill="none" stroke="{PALETTE[j % len(PALETTE)]}" stroke-width="2"{dash}/>'
            )
        p.out.append(
            f'<text x="{ML + j * 200}" y="{H - 22}" font-size="10" fill="{PALETTE[j % len(PALETTE)]}">■ {escape(_short(s["name"], 30))}</text>'
        )
    return _wrap(p.out, spec.get("description", ""), spec["title"])


def _scatter(spec: dict, d: dict) -> str:
    pts = d["points"]
    if not pts:
        return ""
    xs, ys = [q[0] for q in pts], [q[1] for q in pts]
    xr, yr = (max(xs) - min(xs)) * 0.05 or 1, (max(ys) - min(ys)) * 0.05 or 1
    p = _Plot(
        min(xs) - xr, max(xs) + xr, min(ys) - yr, max(ys) + yr, spec.get("x_label"), spec.get("y_label")
    )
    p.frame(_ticks(p.x0, p.x1))
    for x, y in pts:
        p.out.append(
            f'<circle cx="{p.sx(x):.1f}" cy="{p.sy(y):.1f}" r="2.6" fill="{PALETTE[0]}" fill-opacity="0.45"/>'
        )
    if d.get("line"):
        ln = d["line"]
        p.out.append(
            f'<line x1="{p.sx(ln["x0"]):.1f}" y1="{p.sy(ln["y0"]):.1f}" x2="{p.sx(ln["x1"]):.1f}" y2="{p.sy(ln["y1"]):.1f}" stroke="{PALETTE[1]}" stroke-width="2"/>'
        )
    return _wrap(p.out, spec.get("description", ""), spec["title"])


def _hist(spec: dict, d: dict) -> str:
    edges, counts = d["edges"], d["counts"]
    if not counts:
        return ""
    p = _Plot(
        edges[0],
        edges[-1] if edges[-1] != edges[0] else edges[0] + 1,
        0,
        max(counts) * 1.08,
        spec.get("x_label"),
        "Count",
    )
    p.frame(_ticks(p.x0, p.x1))
    for i, c in enumerate(counts):
        x0, x1 = p.sx(edges[i]), p.sx(edges[i + 1] if edges[i + 1] != edges[i] else edges[i] + 1)
        p.out.append(
            f'<rect x="{x0:.1f}" y="{p.sy(c):.1f}" width="{max(x1 - x0 - 1, 1):.1f}" height="{p.sy(0) - p.sy(c):.1f}" fill="{PALETTE[0]}"/>'
        )
    if d.get("mean") is not None:
        p.out.append(
            f'<line x1="{p.sx(d["mean"]):.1f}" x2="{p.sx(d["mean"]):.1f}" y1="{MT}" y2="{H - MB}" stroke="{PALETTE[1]}" stroke-dasharray="4 3"/>'
            f'<text x="{p.sx(d["mean"]) + 4:.1f}" y="{MT + 10}" font-size="10" fill="{PALETTE[1]}">mean {_num(d["mean"])}</text>'
        )
    return _wrap(p.out, spec.get("description", ""), spec["title"])


def _box(spec: dict, d: dict) -> str:
    gs = d["groups"]
    if not gs:
        return ""
    lo = min(min([g["whisker_low"], *g["outliers"]]) for g in gs)
    hi = max(max([g["whisker_high"], *g["outliers"]]) for g in gs)
    pad = (hi - lo) * 0.06 or 1
    p = _Plot(0, len(gs), lo - pad, hi + pad, spec.get("x_label"), spec.get("y_label"))
    p.frame()
    bw = (W - ML - MR) / len(gs) * 0.5
    for i, g in enumerate(gs):
        cx, col = p.sx(i + 0.5), PALETTE[i % len(PALETTE)]
        p.out.append(
            f'<line x1="{cx:.1f}" x2="{cx:.1f}" y1="{p.sy(g["whisker_low"]):.1f}" y2="{p.sy(g["whisker_high"]):.1f}" stroke="{INK}"/>'
            f'<rect x="{cx - bw / 2:.1f}" y="{p.sy(g["q3"]):.1f}" width="{bw:.1f}" height="{p.sy(g["q1"]) - p.sy(g["q3"]):.1f}" fill="{col}" fill-opacity="0.35" stroke="{col}" stroke-width="1.5"/>'
            f'<line x1="{cx - bw / 2:.1f}" x2="{cx + bw / 2:.1f}" y1="{p.sy(g["median"]):.1f}" y2="{p.sy(g["median"]):.1f}" stroke="{INK}" stroke-width="2.2"/>'
        )
        for o in g["outliers"]:
            p.out.append(f'<circle cx="{cx:.1f}" cy="{p.sy(o):.1f}" r="2.4" fill="none" stroke="{col}"/>')
        p.out.append(
            f'<text x="{cx:.1f}" y="{H - MB + 14}" text-anchor="middle" font-size="10" fill="{MUTED}">{escape(_short(g["name"], 12))} (n={g["n"]})</text>'
        )
    return _wrap(p.out, spec.get("description", ""), spec["title"])


def _heat(spec: dict, d: dict) -> str:
    rows, cols, vals = d["rows"], d["cols"], d["values"]
    lo, hi = d["domain"]
    cell = min(48, (W - 160) / max(len(cols), 1))
    h = int(90 + cell * len(rows))
    out = []
    for j, c in enumerate(cols):
        out.append(
            f'<text transform="translate({140 + j * cell + cell / 2},78) rotate(-35)" font-size="10" fill="{MUTED}">{escape(_short(c, 14))}</text>'
        )
    for i, r in enumerate(rows):
        out.append(
            f'<text x="132" y="{90 + i * cell + cell / 2 + 3}" text-anchor="end" font-size="10" fill="{MUTED}">{escape(_short(r, 18))}</text>'
        )
        for j in range(len(cols)):
            v = vals[i][j]
            if v is None:
                col = "#f1f3f2"
            else:
                t = (v - lo) / ((hi - lo) or 1)
                if d.get("diverging"):
                    col = _mix((43, 76, 140), (255, 255, 255), (194, 105, 59), t)
                else:
                    col = _mix((255, 255, 255), (29, 111, 106), (29, 111, 106), t * 2 - 1 if False else t)
            out.append(
                f'<rect x="{140 + j * cell}" y="{90 + i * cell}" width="{cell - 1}" height="{cell - 1}" fill="{col}"/>'
            )
            if v is not None and cell >= 30:
                out.append(
                    f'<text x="{140 + j * cell + cell / 2}" y="{90 + i * cell + cell / 2 + 3}" text-anchor="middle" font-size="9" fill="{INK}">{_num(v)}</text>'
                )
    return _wrap(out, spec.get("description", ""), spec["title"], h)


def _mix(a: tuple, mid: tuple, b: tuple, t: float) -> str:
    t = max(0.0, min(1.0, t))
    x, y, f = (a, mid, t * 2) if t < 0.5 else (mid, b, (t - 0.5) * 2)
    return "#{:02x}{:02x}{:02x}".format(*(int(x[i] + (y[i] - x[i]) * f) for i in range(3)))


def _donut(spec: dict, d: dict) -> str:
    sl = d["slices"]
    tot = sum(s["value"] for s in sl) or 1
    cx, cy, r, r0 = 170, 170, 120, 70
    out, a = [], -math.pi / 2
    for i, s in enumerate(sl):
        da = s["value"] / tot * 2 * math.pi
        a2 = a + da
        x1, y1, x2, y2 = (
            cx + r * math.cos(a),
            cy + r * math.sin(a),
            cx + r * math.cos(a2),
            cy + r * math.sin(a2),
        )
        x3, y3, x4, y4 = (
            cx + r0 * math.cos(a2),
            cy + r0 * math.sin(a2),
            cx + r0 * math.cos(a),
            cy + r0 * math.sin(a),
        )
        large = 1 if da > math.pi else 0
        out.append(
            f'<path d="M{x1:.1f},{y1:.1f} A{r},{r} 0 {large} 1 {x2:.1f},{y2:.1f} L{x3:.1f},{y3:.1f} A{r0},{r0} 0 {large} 0 {x4:.1f},{y4:.1f}Z" fill="{PALETTE[i % len(PALETTE)]}"/>'
        )
        out.append(
            f'<rect x="340" y="{60 + i * 24}" width="12" height="12" fill="{PALETTE[i % len(PALETTE)]}"/><text x="358" y="{70 + i * 24}" font-size="12" fill="{INK}">{escape(_short(s["name"], 24))} — {s["value"] / tot * 100:.1f}%</text>'
        )
        a = a2
    return _wrap(out, spec.get("description", ""), spec["title"], 340)


def _coef(spec: dict, d: dict) -> str:
    items = d["items"]
    if not items:
        return ""
    ref = d.get("reference", 0.0)
    los = [i["lo"] for i in items if i["lo"] is not None] + [ref]
    his = [i["hi"] for i in items if i["hi"] is not None] + [ref]
    lo, hi = min(los), max(his)
    pad = (hi - lo) * 0.08 or 1
    h = max(H, 80 + len(items) * 28)
    left = 150
    sx = lambda v: left + (v - (lo - pad)) / ((hi - lo + 2 * pad) or 1) * (W - left - 30)  # noqa: E731
    out = [
        f'<line x1="{sx(ref):.1f}" x2="{sx(ref):.1f}" y1="10" y2="{h - 40}" stroke="{MUTED}" stroke-dasharray="4 3"/>'
    ]
    for i, it in enumerate(items):
        y = 24 + i * 28
        sig = it.get("p") is not None and it["p"] < 0.05
        col = PALETTE[0] if sig else MUTED
        out.append(
            f'<text x="{left - 8}" y="{y + 4}" text-anchor="end" font-size="11" fill="{INK}">{escape(_short(it["name"], 22))}</text>'
        )
        if it["lo"] is not None and it["hi"] is not None:
            out.append(
                f'<line x1="{sx(it["lo"]):.1f}" x2="{sx(it["hi"]):.1f}" y1="{y}" y2="{y}" stroke="{col}" stroke-width="2"/>'
            )
        if it["estimate"] is not None:
            out.append(f'<circle cx="{sx(it["estimate"]):.1f}" cy="{y}" r="4.5" fill="{col}"/>')
    for t in _ticks(lo - pad, hi + pad):
        out.append(
            f'<text x="{sx(t):.1f}" y="{h - 24}" text-anchor="middle" font-size="10" fill="{MUTED}">{_num(t)}</text>'
        )
    out.append(
        f'<text x="{(left + W) / 2}" y="{h - 8}" text-anchor="middle" font-size="11" fill="{INK}">{escape(spec.get("x_label") or "")}</text>'
    )
    return _wrap(out, spec.get("description", ""), spec["title"], h)


def _roc(spec: dict, d: dict) -> str:
    p = _Plot(0, 1, 0, 1, "False positive rate", "True positive rate")
    p.frame(_ticks(0, 1))
    p.out.append(
        f'<line x1="{p.sx(0)}" y1="{p.sy(0)}" x2="{p.sx(1)}" y2="{p.sy(1)}" stroke="{MUTED}" stroke-dasharray="4 3"/>'
    )
    p.out.append(
        f'<polyline points="{" ".join(f"{p.sx(x):.1f},{p.sy(y):.1f}" for x, y in d["points"])}" fill="none" stroke="{PALETTE[0]}" stroke-width="2.2"/>'
    )
    p.out.append(
        f'<text x="{p.sx(0.55)}" y="{p.sy(0.2)}" font-size="12" fill="{INK}">AUC = {d["auc"]:.3f}</text>'
    )
    return _wrap(p.out, spec.get("description", ""), spec["title"])
