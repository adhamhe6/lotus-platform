import { Link } from "react-router-dom";
import { Provenance } from "@/components/common/Provenance";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtNumber } from "@/lib/format";
import type { Report, SourceKey } from "./reportsApi";
import type { Lookups } from "./sections";

const short = (id: string) => `#${id.slice(0, 8)}`;

/** What this report is built from, as recorded by the server when the report was last saved. */
export function Traceability({ report, pid, lookups }: { report: Report; pid: string; lookups: Lookups }) {
  const base = `/projects/${pid}`;
  const s = report.sources ?? {};
  type Row = { id: string; label: string; to: string };
  const groups: { key: SourceKey; title: string; rows: Row[] }[] = [
    { key: "analysis_runs", title: "Analyses", rows: (s.analysis_runs ?? []).map((id) => ({ id, label: lookups.analyses.find((a) => a.id === id)?.title ?? `Analysis ${short(id)}`, to: `${base}/analysis/${id}` })) },
    { key: "dataset_versions", title: "Dataset versions", rows: (s.dataset_versions ?? []).map((id) => { const v = lookups.versions.find((x) => x.id === id); return { id, label: v ? `${v.datasetName} · v${v.number}` : `Version ${short(id)}`, to: v ? `${base}/data/${v.datasetId}` : `${base}/data` }; }) },
    { key: "insights", title: "Insights", rows: (s.insights ?? []).map((id) => ({ id, label: lookups.insights.find((i) => i.id === id)?.title ?? `Insight ${short(id)}`, to: `${base}/insights` })) },
    { key: "theme_runs", title: "Theme detection runs", rows: (s.theme_runs ?? []).map((id) => ({ id, label: `Theme run ${short(id)}`, to: `${base}/qualitative` })) },
    { key: "mixed_runs", title: "Mixed-methods runs", rows: (s.mixed_runs ?? []).map((id) => { const m = lookups.mixed.find((x) => x.id === id); return { id, label: m ? `${m.outcome_column} × themes in “${m.column_name}”` : `Mixed run ${short(id)}`, to: `${base}/mixed` }; }) },
    { key: "visualizations", title: "Visualizations", rows: (s.visualizations ?? []).map((id) => ({ id, label: lookups.visualizations.find((v) => v.id === id)?.name ?? `Chart ${short(id)}`, to: `${base}/visualizations` })) },
  ];
  const shown = groups.filter((g) => g.rows.length > 0);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="font-display text-lg" id="traceability-title">Traceability</CardTitle>
        <p className="text-[13px] text-muted-foreground">Everything this report draws on, as of the last save.</p>
      </CardHeader>
      <CardContent>
        {shown.length === 0 ? <p className="text-sm text-muted-foreground">No analyses, insights or other sources are referenced yet. Sources appear here once you add and save sections that use them.</p> : (
          <div className="space-y-4" role="region" aria-labelledby="traceability-title">
            {shown.map((g) => (
              <section key={g.key} aria-label={g.title}>
                <h4 className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.title}<span className="tabular rounded-full bg-muted px-1.5 text-[11px] normal-case tracking-normal">{fmtNumber(g.rows.length)}</span>
                  {(g.key === "analysis_runs" || g.key === "insights" || g.key === "visualizations" || g.key === "dataset_versions") && <Provenance kind="computed" className="ml-auto" />}
                  {g.key === "theme_runs" && <Provenance kind="qualitative" className="ml-auto" />}
                </h4>
                <ul className="space-y-0.5">{g.rows.map((r) => <li key={r.id}><Link to={r.to} className="block truncate rounded px-1 py-0.5 text-[13px] text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring" title={r.label}>{r.label}</Link></li>)}</ul>
              </section>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
