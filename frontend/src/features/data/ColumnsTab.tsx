import { ArrowRight, Search, X } from "lucide-react";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import type { Column, Profile } from "@/api/types";
import { Provenance } from "@/components/common/Provenance";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { fmtDate, fmtNumber, fmtPct, SEMANTIC_LABEL } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { HistogramData, TopValue } from "./model";
import { MiniDistribution, MissingBar, TypeBadge } from "./shared";

export function analysisBuilderHref(pid: string, versionId: string, vars: string[]): string {
  return `/projects/${pid}/analysis/new?vars=${vars.map(encodeURIComponent).join(",")}&version=${encodeURIComponent(versionId)}`;
}

export function ColumnsTab({ pid, profile }: { pid: string; profile: Profile }) {
  const nav = useNavigate();
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [active, setActive] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const detailRef = useRef<HTMLDivElement>(null);

  const types = useMemo(() => Array.from(new Set(profile.columns.map((c) => c.semantic_type))), [profile.columns]);
  const shown = profile.columns.filter((c) => (typeFilter === "all" || c.semantic_type === typeFilter) && c.name.toLowerCase().includes(query.trim().toLowerCase()));
  const current = profile.columns.find((c) => c.name === active) ?? null;
  const toggle = (name: string) => setSelected((s) => (s.includes(name) ? s.filter((x) => x !== name) : [...s, name]));
  const open = (name: string) => { setActive(name); setTimeout(() => detailRef.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" }), 0); };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-52 flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" aria-hidden />
          <Input aria-label="Search columns" placeholder="Search columns" className="pl-8" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by type">
          {["all", ...types].map((t) => (
            <button key={t} type="button" aria-pressed={typeFilter === t} onClick={() => setTypeFilter(t)}
              className={cn("rounded-full border px-2.5 py-1 text-xs font-medium transition-colors", typeFilter === t ? "border-primary bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted")}>
              {t === "all" ? "All" : <TypeLabel t={t} />}
            </button>
          ))}
        </div>
        <span className="tabular ml-auto text-xs text-muted-foreground" aria-live="polite">{shown.length} of {profile.columns.length} columns</span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="overflow-hidden">
          {!shown.length ? <p className="p-8 text-center text-sm text-muted-foreground">No column matches “{query}”.</p> : (
            <ul className="divide-y">
              {shown.map((c) => {
                const isSel = selected.includes(c.name);
                return (
                  <li key={c.name} className={cn("flex items-center gap-3 px-3 py-2.5", active === c.name && "bg-accent/40")}>
                    <Checkbox checked={isSel} onCheckedChange={() => toggle(c.name)} aria-label={`Select ${c.name}`} />
                    <button type="button" onClick={() => open(c.name)} aria-pressed={active === c.name} aria-label={`Inspect ${c.name}`} className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-left sm:grid-cols-[minmax(0,1.4fr)_auto_auto_auto]">
                      <span className="min-w-0"><span className="block truncate font-mono text-[13px] font-medium" title={c.name}>{c.name}</span></span>
                      <span className="justify-self-end sm:justify-self-auto"><TypeBadge type={c.semantic_type} /></span>
                      <MissingBar pct={c.missing_pct} className="hidden sm:flex" />
                      <MiniDistribution profile={c.profile} className="hidden sm:flex" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <div ref={detailRef} className="lg:sticky lg:top-4 lg:self-start">
          {current ? <ColumnDetail column={current} total={profile.version.row_count} onClose={() => setActive(null)} /> : (
            <Card className="p-6 text-center text-sm text-muted-foreground">Select a column to see every statistic computed for it.</Card>
          )}
        </div>
      </div>

      {selected.length > 0 && (
        <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-3 shadow-lg" role="region" aria-label="Selected variables">
          <span className="text-sm"><b className="tabular">{selected.length}</b> selected</span>
          <span className="hidden min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground sm:block">{selected.join(", ")}</span>
          <Button variant="ghost" size="sm" onClick={() => setSelected([])}>Clear</Button>
          <Button size="sm" onClick={() => nav(analysisBuilderHref(pid, profile.version.id, selected))}>Start analysis with {selected.length} selected<ArrowRight /></Button>
        </div>
      )}
    </div>
  );
}

function TypeLabel({ t }: { t: string }) {
  return <>{SEMANTIC_LABEL[t] ?? t}</>;
}

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

function ColumnDetail({ column: c, total, onClose }: { column: Column; total: number; onClose: () => void }) {
  const p = c.profile;
  const hist = p.histogram as HistogramData | undefined;
  const top = p.top_values as TopValue[] | undefined;
  const valueCounts = p.value_counts as TopValue[] | undefined;
  const bounds = p.outlier_bounds as number[] | undefined;
  const isDate = c.semantic_type === "datetime";
  const stats: [string, ReactNode][] = [
    ["Count", fmtNumber(p.count)], ["Missing", `${fmtNumber(c.missing_count)} (${fmtPct(c.missing_pct)})`], ["Unique values", fmtNumber(c.unique_count)],
  ];
  const add = (label: string, v: unknown, fmt: (x: unknown) => ReactNode = fmtNumber) => { if (v !== undefined && v !== null) stats.push([label, fmt(v)]); };
  if (!isDate) {
    add("Mean", p.mean); add("Median", p.median); add("Std. deviation", p.std); add("Minimum", p.min); add("Maximum", p.max);
    add("Lower quartile (Q1)", p.q1); add("Upper quartile (Q3)", p.q3); add("Skewness", p.skewness);
    if (num(p.outlier_count) !== undefined) stats.push(["Outliers (IQR rule)", fmtNumber(p.outlier_count)]);
    if (bounds?.length === 2) stats.push(["Outlier bounds", `${fmtNumber(bounds[0])} to ${fmtNumber(bounds[1])}`]);
  } else {
    add("Earliest", p.min, (x) => fmtDate(String(x))); add("Latest", p.max, (x) => fmtDate(String(x)));
    add("Span (days)", p.span_days); add("Distinct months", p.distinct_months); add("Distinct days", p.distinct_days);
  }
  add("Categories", p.category_count); add("Most common", p.mode, (x) => String(x));
  add("Avg. characters", p.avg_chars); add("Avg. words", p.avg_words); add("Longest (chars)", p.max_chars); add("Empty strings", p.empty_count);

  return (
    <Card className="space-y-4 p-4" aria-label={`Details for ${c.name}`} role="region">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate font-mono text-[15px] font-semibold" title={c.name}>{c.name}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-1.5"><TypeBadge type={c.semantic_type} /><span className="text-xs text-muted-foreground">stored as {c.dtype}</span></div>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Close details" onClick={onClose}><X /></Button>
      </div>

      {hist?.counts?.length ? <Histogram h={hist} /> : null}
      {top?.length ? <TopValues rows={top} total={total} /> : null}
      {!hist?.counts?.length && valueCounts?.length ? <TopValues rows={valueCounts} total={total} /> : null}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 border-t pt-3 text-[13px]">
        {stats.map(([k, v]) => (
          <div key={k} className="min-w-0"><dt className="text-xs text-muted-foreground">{k}</dt><dd className="tabular truncate font-medium" title={typeof v === "string" ? v : undefined}>{v}</dd></div>
        ))}
      </dl>
      <div className="flex justify-end"><Provenance kind="computed" /></div>
    </Card>
  );
}

function Histogram({ h }: { h: HistogramData }) {
  const max = Math.max(...h.counts, 1);
  const first = h.edges[0];
  const last = h.edges[h.edges.length - 1];
  return (
    <figure className="space-y-1" aria-label="Distribution">
      <div className="flex h-24 items-end gap-px rounded-md bg-muted/40 px-1 pt-1" role="img" aria-label={`Histogram with ${h.counts.length} bins from ${fmtNumber(first)} to ${fmtNumber(last)}`}>
        {h.counts.map((c, i) => (
          <span key={i} className="flex-1 rounded-t-sm bg-primary/75" style={{ height: `${Math.max(3, (c / max) * 100)}%` }} title={`${fmtNumber(h.edges[i])} – ${fmtNumber(h.edges[i + 1])}: ${fmtNumber(c)}`} />
        ))}
      </div>
      <figcaption className="tabular flex justify-between text-[11px] text-muted-foreground"><span>{fmtNumber(first)}</span><span>{fmtNumber(last)}</span></figcaption>
    </figure>
  );
}

function TopValues({ rows, total }: { rows: TopValue[]; total: number }) {
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <div className="space-y-1.5" aria-label="Most frequent values">
      <p className="text-xs font-medium text-muted-foreground">{rows.length >= 10 ? "Top values" : "Values"} <span className="font-normal">(of {fmtNumber(total)} rows)</span></p>
      <ul className="space-y-1">
        {rows.map((r, i) => (
          <li key={i} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 text-xs">
            <div className="relative h-5 overflow-hidden rounded bg-muted/50">
              <span className="absolute inset-y-0 left-0 rounded bg-primary/25" style={{ width: `${Math.max(2, (r.count / max) * 100)}%` }} aria-hidden />
              <span className="relative block truncate px-1.5 leading-5" title={String(r.value)}>{String(r.value)}</span>
            </div>
            <span className="tabular text-muted-foreground">{fmtNumber(r.count)}{typeof r.pct === "number" ? ` · ${fmtPct(r.pct)}` : ""}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
