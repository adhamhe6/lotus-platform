import { Table2 } from "lucide-react";
import { useId, useMemo, useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ErrorBar, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Scatter, ScatterChart, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import type { ChartSpec } from "@/api/types";
import { cn } from "@/lib/utils";
import { fmtNumber } from "@/lib/format";
import { divColor, seqColor, seriesColor, textOn } from "./palette";
import { linear, niceTicks, tickFmt } from "./scales";

const axisProps = { stroke: "var(--chart-axis)", tick: { fill: "var(--chart-muted)", fontSize: 11 }, tickLine: false } as const;
const tooltipStyle = { background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "var(--foreground)", boxShadow: "0 6px 20px rgb(0 0 0 / .12)" };
const GAP = { stroke: "var(--chart-surface)", strokeWidth: 2 } as const; // 2px surface gap between adjacent fills

type D = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Renders a server-computed ChartSpec. All values come from the API — nothing is computed or invented here. */
export function ChartView({ spec, height = 300, className, bare }: { spec: ChartSpec; height?: number; className?: string; bare?: boolean }) {
  const [table, setTable] = useState(false);
  const id = useId();
  const d = spec.data as D;
  return (
    <figure className={cn("min-w-0 space-y-2", className)} aria-labelledby={`${id}-t`} aria-describedby={`${id}-d`}>
      {!bare && (
        <figcaption className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div id={`${id}-t`} className="text-sm font-semibold leading-snug">{spec.title}</div>
            {spec.subtitle && <div className="text-xs text-muted-foreground">{spec.subtitle}</div>}
          </div>
          <button type="button" onClick={() => setTable((v) => !v)} aria-pressed={table} className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
            <Table2 className="size-3.5" aria-hidden />{table ? "Chart" : "Data"}
          </button>
        </figcaption>
      )}
      <p id={`${id}-d`} className="sr-only">{spec.description}</p>
      {table ? <DataTable spec={spec} /> : (
        <div role="img" aria-label={spec.description} style={{ height }}>
          <Plot spec={spec} d={d} height={height} />
        </div>
      )}
      {spec.notes?.length > 0 && <p className="text-xs text-muted-foreground">{spec.notes.join(" ")}</p>}
    </figure>
  );
}

function Plot({ spec, d, height }: { spec: ChartSpec; d: D; height: number }) {
  switch (spec.kind) {
    case "bar": case "hbar": return <BarPlot spec={spec} d={d} />;
    case "stacked_bar": return <StackedPlot spec={spec} d={d} />;
    case "line": return <LinePlot spec={spec} d={d} />;
    case "scatter": return <ScatterPlot spec={spec} d={d} />;
    case "histogram": return <Histogram spec={spec} d={d} height={height} />;
    case "box": return <BoxPlot spec={spec} d={d} height={height} />;
    case "heatmap": return <Heatmap spec={spec} d={d} />;
    case "donut": return <Donut d={d} />;
    case "coef": return <CoefPlot spec={spec} d={d} />;
    case "roc": return <RocPlot d={d} height={height} />;
    default: return null;
  }
}

const xLabel = (l?: string | null) => (l ? { value: l, position: "insideBottom" as const, offset: -4, fill: "var(--chart-text)", fontSize: 11 } : undefined);
const yLabel = (l?: string | null) => (l ? { value: l, angle: -90, position: "insideLeft" as const, offset: 8, fill: "var(--chart-text)", fontSize: 11, style: { textAnchor: "middle" as const } } : undefined);

function BarPlot({ spec, d }: { spec: ChartSpec; d: D }) {
  const s = d.series[0];
  const horizontal = spec.kind === "hbar";
  const rows = d.categories.map((c: string, i: number) => ({
    name: c, v: s.values[i], err: s.errors?.[i] && s.errors[i][0] != null ? [s.values[i] - s.errors[i][0], s.errors[i][1] - s.values[i]] : undefined, n: d.counts?.[i],
  }));
  const color = seriesColor(0);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows} layout={horizontal ? "vertical" : "horizontal"} margin={{ top: 16, right: 16, bottom: 22, left: horizontal ? 0 : 8 }} barCategoryGap="28%">
        <CartesianGrid stroke="var(--chart-grid)" vertical={horizontal} horizontal={!horizontal} />
        {horizontal ? (<><XAxis type="number" {...axisProps} tickFormatter={tickFmt} label={xLabel(spec.y_label)} /><YAxis type="category" dataKey="name" width={130} {...axisProps} interval={0} /></>)
          : (<><XAxis dataKey="name" {...axisProps} interval={0} tickFormatter={(v: string) => (v.length > 14 ? `${v.slice(0, 13)}…` : v)} label={xLabel(spec.x_label)} /><YAxis {...axisProps} tickFormatter={tickFmt} label={yLabel(spec.y_label)} domain={[(m: number) => Math.min(0, m), "auto"]} /></>)}
        <RTooltip cursor={{ fill: "var(--muted)", opacity: 0.5 }} contentStyle={tooltipStyle} formatter={(v) => fmtNumber(v as number)} labelFormatter={(l, p) => `${l}${p?.[0]?.payload?.n != null ? ` (n = ${p[0].payload.n})` : ""}`} />
        <Bar dataKey="v" name={spec.y_label ?? "Value"} fill={color} radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]} maxBarSize={44} isAnimationActive={false}>
          {rows.map((_: unknown, i: number) => <Cell key={i} fill={color} {...GAP} />)}
          {rows.some((r: D) => r.err) && <ErrorBar dataKey="err" width={5} stroke="var(--chart-text)" strokeWidth={1.5} />}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function StackedPlot({ spec, d }: { spec: ChartSpec; d: D }) {
  const rows = d.categories.map((c: string, i: number) => Object.fromEntries([["name", c], ...d.series.map((s: D) => [s.name, s.values[i]])]));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows} margin={{ top: 8, right: 16, bottom: 22, left: 8 }} barCategoryGap="28%">
        <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
        <XAxis dataKey="name" {...axisProps} interval={0} label={xLabel(spec.x_label)} />
        <YAxis {...axisProps} tickFormatter={(v) => (d.percent ? `${v}%` : tickFmt(v))} label={yLabel(spec.y_label)} domain={d.percent ? [0, 100] : undefined} />
        <RTooltip contentStyle={tooltipStyle} formatter={(v) => (d.percent ? `${fmtNumber(v as number, 1)}%` : fmtNumber(v as number))} />
        <Legend wrapperStyle={{ fontSize: 12, color: "var(--chart-muted)" }} />
        {d.series.map((s: D, i: number) => <Bar key={s.name} dataKey={s.name} stackId="a" fill={seriesColor(i)} maxBarSize={56} isAnimationActive={false} {...GAP} />)}
      </BarChart>
    </ResponsiveContainer>
  );
}

function LinePlot({ spec, d }: { spec: ChartSpec; d: D }) {
  const rows = d.x.map((x: string, i: number) => Object.fromEntries([["x", x], ...d.series.map((s: D) => [s.name, s.values[i]])]));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={rows} margin={{ top: 12, right: 16, bottom: 22, left: 8 }}>
        <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
        <XAxis dataKey="x" {...axisProps} minTickGap={28} label={xLabel(spec.x_label)} />
        <YAxis {...axisProps} tickFormatter={tickFmt} label={yLabel(spec.y_label)} domain={["auto", "auto"]} />
        <RTooltip contentStyle={tooltipStyle} formatter={(v) => fmtNumber(v as number)} />
        {d.series.length > 1 && <Legend wrapperStyle={{ fontSize: 12, color: "var(--chart-muted)" }} />}
        {d.series.map((s: D, i: number) => (
          <Line key={s.name} type="monotone" dataKey={s.name} stroke={seriesColor(i)} strokeWidth={2} strokeDasharray={s.dashed ? "5 4" : undefined} dot={rows.length <= 40 ? { r: 3, stroke: "var(--chart-surface)", strokeWidth: 2 } : false} activeDot={{ r: 5, stroke: "var(--chart-surface)", strokeWidth: 2 }} connectNulls={false} isAnimationActive={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

function ScatterPlot({ spec, d }: { spec: ChartSpec; d: D }) {
  const pts = d.points.map((p: number[]) => ({ x: p[0], y: p[1] }));
  const line = d.line ? [{ x: d.line.x0, y: d.line.y0 }, { x: d.line.x1, y: d.line.y1 }] : null;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ScatterChart margin={{ top: 12, right: 16, bottom: 22, left: 8 }}>
        <CartesianGrid stroke="var(--chart-grid)" />
        <XAxis type="number" dataKey="x" name={spec.x_label ?? "x"} {...axisProps} tickFormatter={tickFmt} domain={["auto", "auto"]} label={xLabel(spec.x_label)} />
        <YAxis type="number" dataKey="y" name={spec.y_label ?? "y"} {...axisProps} tickFormatter={tickFmt} domain={["auto", "auto"]} label={yLabel(spec.y_label)} />
        <RTooltip cursor={{ strokeDasharray: "3 3" }} contentStyle={tooltipStyle} formatter={(v) => fmtNumber(v as number)} />
        <Scatter data={pts} fill={seriesColor(0)} fillOpacity={0.5} isAnimationActive={false} />
        {line && <Scatter data={line} line={{ stroke: seriesColor(1), strokeWidth: 2 }} shape={() => <g />} legendType="none" isAnimationActive={false} />}
      </ScatterChart>
    </ResponsiveContainer>
  );
}

function Donut({ d }: { d: D }) {
  const total = d.slices.reduce((a: number, s: D) => a + s.value, 0);
  return (
    <div className="flex h-full items-center gap-6">
      <ResponsiveContainer width="55%" height="100%">
        <PieChart>
          <Pie data={d.slices} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="90%" paddingAngle={1} isAnimationActive={false} stroke="var(--chart-surface)" strokeWidth={2}>
            {d.slices.map((_: unknown, i: number) => <Cell key={i} fill={seriesColor(i)} />)}
          </Pie>
          <RTooltip contentStyle={tooltipStyle} formatter={(v) => `${fmtNumber(v as number)} (${((Number(v) / total) * 100).toFixed(1)}%)`} />
        </PieChart>
      </ResponsiveContainer>
      <ul className="min-w-0 flex-1 space-y-1.5 text-sm">
        {d.slices.map((s: D, i: number) => (
          <li key={s.name} className="flex items-center gap-2"><span className="size-2.5 shrink-0 rounded-sm" style={{ background: seriesColor(i) }} /><span className="truncate">{s.name}</span><span className="tabular ml-auto text-muted-foreground">{((s.value / total) * 100).toFixed(1)}%</span></li>
        ))}
      </ul>
    </div>
  );
}

// ── custom SVG charts ──────────────────────────────────────────────────────────────────
function useBox(height: number, left = 56, right = 16, top = 14, bottom = 44) {
  const [w, setW] = useState(640);
  const ref = (el: SVGSVGElement | null) => { if (el && el.parentElement) { const nw = el.parentElement.clientWidth; if (nw && nw !== w) setW(nw); } };
  return { w, ref, L: left, R: w - right, T: top, B: height - bottom, height };
}

function Axes({ b, xs, ys, xl, yl, xFmt }: { b: ReturnType<typeof useBox>; xs?: number[]; ys: number[]; xl?: string | null; yl?: string | null; xFmt?: (v: number) => string; xScale?: (v: number) => number; yScale?: (v: number) => number } & { yScale: (v: number) => number; xScale?: (v: number) => number }) {
  return (
    <g>
      {ys.map((t) => (<g key={t}><line x1={b.L} x2={b.R} y1={yScaleOf(b, ys, t)} y2={yScaleOf(b, ys, t)} stroke="var(--chart-grid)" /><text x={b.L - 6} y={yScaleOf(b, ys, t) + 4} textAnchor="end" fontSize={11} fill="var(--chart-muted)">{tickFmt(t)}</text></g>))}
      <line x1={b.L} x2={b.R} y1={b.B} y2={b.B} stroke="var(--chart-axis)" />
      {xs && xs.map((t) => <text key={t} x={xScaleOf(b, xs, t)} y={b.B + 16} textAnchor="middle" fontSize={11} fill="var(--chart-muted)">{(xFmt ?? tickFmt)(t)}</text>)}
      {xl && <text x={(b.L + b.R) / 2} y={b.height - 6} textAnchor="middle" fontSize={11} fill="var(--chart-text)">{xl}</text>}
      {yl && <text transform={`translate(13 ${(b.T + b.B) / 2}) rotate(-90)`} textAnchor="middle" fontSize={11} fill="var(--chart-text)">{yl}</text>}
    </g>
  );
}
const yScaleOf = (b: ReturnType<typeof useBox>, ys: number[], v: number) => linear(ys[0], ys[ys.length - 1], b.B, b.T)(v);
const xScaleOf = (b: ReturnType<typeof useBox>, xs: number[], v: number) => linear(xs[0], xs[xs.length - 1], b.L, b.R)(v);

function Histogram({ spec, d, height }: { spec: ChartSpec; d: D; height: number }) {
  const b = useBox(height);
  const [hover, setHover] = useState<number | null>(null);
  const { edges, counts } = d as { edges: number[]; counts: number[] };
  if (!counts?.length) return null;
  const x0 = edges[0], x1 = edges[edges.length - 1] === edges[0] ? edges[0] + 1 : edges[edges.length - 1];
  const ymax = Math.max(...counts);
  const ys = niceTicks(0, ymax * 1.05, 5);
  const xs = niceTicks(x0, x1, 6);
  const sx = linear(x0, x1, b.L, b.R), sy = linear(0, ys[ys.length - 1], b.B, b.T);
  return (
    <div className="relative size-full">
      <svg ref={b.ref} width="100%" height={height} onMouseLeave={() => setHover(null)}>
        <Axes b={b} xs={xs} ys={ys} xl={spec.x_label} yl="Count" yScale={sy} xScale={sx} />
        {counts.map((c, i) => {
          const xa = sx(edges[i]), xb = sx(edges[i + 1] === edges[i] ? edges[i] + 1 : edges[i + 1]);
          return <rect key={i} x={xa + 1} y={sy(c)} width={Math.max(xb - xa - 2, 1)} height={b.B - sy(c)} rx={2} fill={seriesColor(0)} opacity={hover === null || hover === i ? 1 : 0.55} onMouseEnter={() => setHover(i)} />;
        })}
        {typeof d.mean === "number" && <g><line x1={sx(d.mean)} x2={sx(d.mean)} y1={b.T} y2={b.B} stroke="var(--chart-text)" strokeDasharray="4 3" /><text x={sx(d.mean) + 5} y={b.T + 10} fontSize={11} fill="var(--chart-text)">mean {fmtNumber(d.mean)}</text></g>}
      </svg>
      {hover !== null && <Tip x={sx((edges[hover] + edges[hover + 1]) / 2)} y={sy(counts[hover])}>{fmtNumber(edges[hover])} – {fmtNumber(edges[hover + 1])}: <b>{counts[hover]}</b></Tip>}
    </div>
  );
}

function Tip({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  return <div className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border bg-card px-2 py-1 text-xs shadow-lg" style={{ left: x, top: y - 6 }}>{children}</div>;
}

function BoxPlot({ spec, d, height }: { spec: ChartSpec; d: D; height: number }) {
  const b = useBox(height, 56, 16, 14, 52);
  const [hover, setHover] = useState<number | null>(null);
  const groups: D[] = d.groups;
  if (!groups.length) return null;
  const all = groups.flatMap((g) => [g.whisker_low, g.whisker_high, ...g.outliers]);
  const lo = Math.min(...all), hi = Math.max(...all), pad = (hi - lo) * 0.06 || 1;
  const ys = niceTicks(lo - pad, hi + pad, 5);
  const sy = linear(ys[0], ys[ys.length - 1], b.B, b.T);
  const band = (b.R - b.L) / groups.length, bw = Math.min(64, band * 0.5);
  return (
    <div className="relative size-full">
      <svg ref={b.ref} width="100%" height={height} onMouseLeave={() => setHover(null)}>
        <Axes b={b} ys={ys} yl={spec.y_label} xl={spec.x_label} yScale={sy} />
        {groups.map((g, i) => {
          const cx = b.L + band * (i + 0.5), col = seriesColor(i);
          return (
            <g key={g.name} onMouseEnter={() => setHover(i)} opacity={hover === null || hover === i ? 1 : 0.6}>
              <rect x={cx - band / 2} y={b.T} width={band} height={b.B - b.T} fill="transparent" />
              <line x1={cx} x2={cx} y1={sy(g.whisker_low)} y2={sy(g.whisker_high)} stroke="var(--chart-text)" />
              <line x1={cx - bw / 4} x2={cx + bw / 4} y1={sy(g.whisker_low)} y2={sy(g.whisker_low)} stroke="var(--chart-text)" /><line x1={cx - bw / 4} x2={cx + bw / 4} y1={sy(g.whisker_high)} y2={sy(g.whisker_high)} stroke="var(--chart-text)" />
              <rect x={cx - bw / 2} y={sy(g.q3)} width={bw} height={Math.max(sy(g.q1) - sy(g.q3), 1)} rx={3} fill={col} fillOpacity={0.3} stroke={col} strokeWidth={1.5} />
              <line x1={cx - bw / 2} x2={cx + bw / 2} y1={sy(g.median)} y2={sy(g.median)} stroke="var(--chart-text)" strokeWidth={2.4} />
              <circle cx={cx} cy={sy(g.mean)} r={3} fill="var(--chart-surface)" stroke="var(--chart-text)" strokeWidth={1.2} />
              {g.outliers.map((o: number, k: number) => <circle key={k} cx={cx} cy={sy(o)} r={2.6} fill="none" stroke={col} />)}
              <text x={cx} y={b.B + 16} textAnchor="middle" fontSize={11} fill="var(--chart-muted)">{String(g.name).length > 12 ? `${String(g.name).slice(0, 11)}…` : g.name}</text>
              <text x={cx} y={b.B + 30} textAnchor="middle" fontSize={10} fill="var(--chart-muted)">n = {g.n}</text>
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <Tip x={b.L + band * (hover + 0.5)} y={sy(groups[hover].q3)}>
          <div className="font-semibold">{groups[hover].name} <span className="font-normal text-muted-foreground">n = {groups[hover].n}</span></div>
          <div className="tabular">median {fmtNumber(groups[hover].median)} · mean {fmtNumber(groups[hover].mean)}</div>
          <div className="tabular text-muted-foreground">Q1 {fmtNumber(groups[hover].q1)} – Q3 {fmtNumber(groups[hover].q3)}{groups[hover].n_outliers ? ` · ${groups[hover].n_outliers} outliers` : ""}</div>
        </Tip>
      )}
    </div>
  );
}

function Heatmap({ spec, d }: { spec: ChartSpec; d: D }) {
  const rows: string[] = d.rows, cols: string[] = d.cols, vals: (number | null)[][] = d.values;
  const [lo, hi]: [number, number] = d.domain;
  const [hover, setHover] = useState<[number, number] | null>(null);
  const cell = Math.max(34, Math.min(64, 520 / Math.max(cols.length, 1)));
  const left = Math.min(150, 12 + Math.max(...rows.map((r) => r.length)) * 6.2), top = 78;
  const W = left + cols.length * cell + 90, H = top + rows.length * cell + 12;
  const color = (v: number) => (d.diverging ? divColor(((v - (lo + hi) / 2) / ((hi - lo) / 2)) || 0) : seqColor((v - lo) / (hi - lo || 1)));
  const tnorm = (v: number) => (d.diverging ? ((v - (lo + hi) / 2) / ((hi - lo) / 2)) || 0 : (v - lo) / (hi - lo || 1));
  return (
    <div className="scroll-thin relative size-full overflow-auto">
      <svg width={W} height={H} role="presentation" onMouseLeave={() => setHover(null)}>
        {cols.map((c, j) => <text key={c} transform={`translate(${left + j * cell + cell / 2} ${top - 8}) rotate(-35)`} fontSize={11} fill="var(--chart-muted)">{c.length > 16 ? `${c.slice(0, 15)}…` : c}</text>)}
        {rows.map((r, i) => (
          <g key={r}>
            <text x={left - 8} y={top + i * cell + cell / 2 + 4} textAnchor="end" fontSize={11} fill="var(--chart-muted)">{r.length > 22 ? `${r.slice(0, 21)}…` : r}</text>
            {cols.map((c, j) => {
              const v = vals[i][j];
              return (
                <g key={c} onMouseEnter={() => setHover([i, j])}>
                  <rect x={left + j * cell} y={top + i * cell} width={cell - 2} height={cell - 2} rx={3} fill={v === null ? "var(--muted)" : color(v)} stroke={hover?.[0] === i && hover?.[1] === j ? "var(--chart-text)" : "none"} strokeWidth={1.5} />
                  {v !== null && cell >= 40 && <text x={left + j * cell + cell / 2 - 1} y={top + i * cell + cell / 2 + 3} textAnchor="middle" fontSize={10.5} fill={textOn(tnorm(v))}>{fmtNumber(v, 2)}</text>}
                </g>
              );
            })}
          </g>
        ))}
        <g transform={`translate(${left + cols.length * cell + 14} ${top})`}>
          {Array.from({ length: 7 }).map((_, k) => { const t = k / 6; const v = hi - t * (hi - lo); return <rect key={k} y={k * 16} width={12} height={16} fill={color(v)} />; })}
          <text x={18} y={10} fontSize={10} fill="var(--chart-muted)">{fmtNumber(hi, 2)}</text><text x={18} y={6 * 16 + 14} fontSize={10} fill="var(--chart-muted)">{fmtNumber(lo, 2)}</text>
        </g>
      </svg>
      <div className="mt-1 text-xs text-muted-foreground" aria-live="polite">{hover ? `${rows[hover[0]]} × ${cols[hover[1]]}: ${vals[hover[0]][hover[1]] === null ? "n/a" : fmtNumber(vals[hover[0]][hover[1]], 3)} (${spec.data.value_label ?? "value"})` : spec.data.value_label ?? ""}</div>
    </div>
  );
}

function CoefPlot({ spec, d }: { spec: ChartSpec; d: D }) {
  const items: D[] = d.items;
  const rowH = 30, left = 150;
  const height = 40 + items.length * rowH + 30;
  const b = useBox(height, left, 20, 10, 34);
  const ref0: number = d.reference ?? 0;
  const vals = items.flatMap((i) => [i.lo, i.hi, i.estimate]).filter((v) => v != null) as number[];
  const lo = Math.min(ref0, ...vals), hi = Math.max(ref0, ...vals), pad = (hi - lo) * 0.08 || 1;
  const xs = niceTicks(lo - pad, hi + pad, 5), sx = linear(xs[0], xs[xs.length - 1], b.L, b.R);
  return (
    <div className="scroll-thin size-full overflow-y-auto">
      <svg ref={b.ref} width="100%" height={height}>
        {xs.map((t) => <g key={t}><line x1={sx(t)} x2={sx(t)} y1={b.T} y2={height - 34} stroke="var(--chart-grid)" /><text x={sx(t)} y={height - 18} textAnchor="middle" fontSize={11} fill="var(--chart-muted)">{tickFmt(t)}</text></g>)}
        <line x1={sx(ref0)} x2={sx(ref0)} y1={b.T} y2={height - 34} stroke="var(--chart-axis)" strokeDasharray="4 3" />
        {items.map((it, i) => {
          const y = b.T + 16 + i * rowH, sig = it.p != null && it.p < 0.05, col = sig ? seriesColor(0) : "var(--chart-axis)";
          return (
            <g key={it.name}>
              <text x={left - 10} y={y + 4} textAnchor="end" fontSize={12} fill="var(--chart-text)">{String(it.name).length > 20 ? `${String(it.name).slice(0, 19)}…` : it.name}</text>
              {it.lo != null && it.hi != null && <line x1={sx(it.lo)} x2={sx(it.hi)} y1={y} y2={y} stroke={col} strokeWidth={2} />}
              {it.estimate != null && <circle cx={sx(it.estimate)} cy={y} r={5} fill={col} stroke="var(--chart-surface)" strokeWidth={2}><title>{`${it.name}: ${fmtNumber(it.estimate)} [${fmtNumber(it.lo)}, ${fmtNumber(it.hi)}]${it.p != null ? `, p ${it.p < 0.001 ? "< 0.001" : it.p.toFixed(3)}` : ""}`}</title></circle>}
            </g>
          );
        })}
        {spec.x_label && <text x={(b.L + b.R) / 2} y={height - 3} textAnchor="middle" fontSize={11} fill="var(--chart-text)">{spec.x_label}</text>}
      </svg>
      <p className="mt-1 flex items-center gap-3 text-xs text-muted-foreground"><span className="inline-flex items-center gap-1"><i className="inline-block size-2.5 rounded-full" style={{ background: seriesColor(0) }} />p &lt; 0.05</span><span className="inline-flex items-center gap-1"><i className="inline-block size-2.5 rounded-full" style={{ background: "var(--chart-axis)" }} />not significant</span></p>
    </div>
  );
}

function RocPlot({ d, height }: { d: D; height: number }) {
  const b = useBox(height);
  const t = [0, 0.25, 0.5, 0.75, 1];
  const sx = linear(0, 1, b.L, b.R), sy = linear(0, 1, b.B, b.T);
  const path = (d.points as number[][]).map((p, i) => `${i ? "L" : "M"}${sx(p[0]).toFixed(1)} ${sy(p[1]).toFixed(1)}`).join("");
  return (
    <svg ref={b.ref} width="100%" height={height}>
      {t.map((v) => <g key={v}><line x1={b.L} x2={b.R} y1={sy(v)} y2={sy(v)} stroke="var(--chart-grid)" /><text x={b.L - 6} y={sy(v) + 4} textAnchor="end" fontSize={11} fill="var(--chart-muted)">{v}</text><text x={sx(v)} y={b.B + 16} textAnchor="middle" fontSize={11} fill="var(--chart-muted)">{v}</text></g>)}
      <line x1={sx(0)} y1={sy(0)} x2={sx(1)} y2={sy(1)} stroke="var(--chart-axis)" strokeDasharray="4 3" />
      <path d={path} fill="none" stroke={seriesColor(0)} strokeWidth={2.4} />
      <text x={sx(0.55)} y={sy(0.22)} fontSize={13} fontWeight={600} fill="var(--chart-text)">AUC = {fmtNumber(d.auc, 3)}</text>
      <text x={(b.L + b.R) / 2} y={height - 6} textAnchor="middle" fontSize={11} fill="var(--chart-text)">False positive rate</text>
      <text transform={`translate(13 ${(b.T + b.B) / 2}) rotate(-90)`} textAnchor="middle" fontSize={11} fill="var(--chart-text)">True positive rate</text>
    </svg>
  );
}

// ── "Data" view: every chart has a table alternative ───────────────────────────────────
function DataTable({ spec }: { spec: ChartSpec }) {
  const d = spec.data as D;
  const { head, rows } = useMemo(() => tabulate(spec), [spec]);
  return (
    <div className="scroll-thin max-h-72 overflow-auto rounded-md border">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-muted"><tr>{head.map((h) => <th key={h} className="px-2.5 py-1.5 text-left font-semibold">{h}</th>)}</tr></thead>
        <tbody>{rows.slice(0, 200).map((r, i) => <tr key={i} className="border-t">{r.map((c, j) => <td key={j} className="tabular px-2.5 py-1">{typeof c === "number" ? fmtNumber(c) : c ?? "—"}</td>)}</tr>)}</tbody>
      </table>
      {d.points && d.points.length > 200 && <p className="p-2 text-muted-foreground">Showing the first 200 of {d.points.length} plotted points.</p>}
    </div>
  );
}

function tabulate(spec: ChartSpec): { head: string[]; rows: (string | number | null)[][] } {
  const d = spec.data as D;
  switch (spec.kind) {
    case "bar": case "hbar": return { head: [spec.x_label ?? "Category", spec.y_label ?? "Value", "Lower", "Upper"], rows: d.categories.map((c: string, i: number) => [c, d.series[0].values[i], d.series[0].errors?.[i]?.[0] ?? null, d.series[0].errors?.[i]?.[1] ?? null]) };
    case "stacked_bar": return { head: [spec.x_label ?? "Category", ...d.series.map((s: D) => s.name)], rows: d.categories.map((c: string, i: number) => [c, ...d.series.map((s: D) => s.values[i])]) };
    case "line": return { head: [spec.x_label ?? "x", ...d.series.map((s: D) => s.name)], rows: d.x.map((x: string, i: number) => [x, ...d.series.map((s: D) => s.values[i])]) };
    case "scatter": return { head: [spec.x_label ?? "x", spec.y_label ?? "y"], rows: d.points };
    case "histogram": return { head: ["From", "To", "Count"], rows: d.counts.map((c: number, i: number) => [d.edges[i], d.edges[i + 1], c]) };
    case "box": return { head: ["Group", "n", "Min (whisker)", "Q1", "Median", "Mean", "Q3", "Max (whisker)", "Outliers"], rows: d.groups.map((g: D) => [g.name, g.n, g.whisker_low, g.q1, g.median, g.mean, g.q3, g.whisker_high, g.n_outliers]) };
    case "heatmap": return { head: ["", ...d.cols], rows: d.rows.map((r: string, i: number) => [r, ...d.values[i]]) };
    case "donut": return { head: ["Part", "Value"], rows: d.slices.map((s: D) => [s.name, s.value]) };
    case "coef": return { head: ["Term", "Estimate", "Lower", "Upper", "p"], rows: d.items.map((i: D) => [i.name, i.estimate, i.lo, i.hi, i.p]) };
    case "roc": return { head: ["False positive rate", "True positive rate"], rows: d.points };
    default: return { head: [], rows: [] };
  }
}
