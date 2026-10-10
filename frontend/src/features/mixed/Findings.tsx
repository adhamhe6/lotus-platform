import { Quote, ShieldCheck } from "lucide-react";
import { Provenance } from "@/components/common/Provenance";
import { Badge } from "@/components/ui/badge";
import { fmtNumber, fmtP, fmtPct, titleCase } from "@/lib/format";
import type { Finding, MixedResult } from "./api";

const KIND: Record<Finding["kind"], string> = { outcome_difference: "Outcome difference", convergence: "Convergence", group_prevalence: "Group prevalence" };
const QUAL_TIP: Record<Finding["qualification"], string> = {
  strong: "Very small adjusted p, at least a medium effect and a large enough group.",
  moderate: "Clearly beyond chance after correction, with a meaningful effect.",
  tentative: "Passed the thresholds but with less margin; treat as a lead to check.",
};
const LABEL: Record<string, string> = {
  mean_with: "Mean with", mean_without: "Mean without", diff: "Difference", g: "Hedges’ g", p_adj: "Holm p", n_with: "n with", n_without: "n without",
  top_group: "Highest in", top_pct: "Highest share", low_group: "Lowest in", low_pct: "Lowest share",
};
const fmtNum = (k: string, v: number | string | null) => (k === "p_adj" ? fmtP(v) : k.endsWith("_pct") ? fmtPct(v) : k.startsWith("n_") ? fmtNumber(v) : typeof v === "number" ? fmtNumber(v, 2) : String(v ?? "—"));

function QualChip({ q }: { q: Finding["qualification"] }) {
  return <span title={QUAL_TIP[q]}><Badge variant={q === "tentative" ? "warning" : q === "strong" ? "success" : "computed"}><ShieldCheck className="size-3" aria-hidden />{titleCase(q)}</Badge></span>;
}

export function FindingCard({ f, result }: { f: Finding; result: MixedResult }) {
  const item = result.items.find((i) => f.id.startsWith(`${i.id}:`));
  const quotes = [...new Set(item?.quotes ?? [])];
  return (
    <article className="overflow-hidden rounded-xl border bg-card" aria-label={`Finding: ${f.item}`}>
      <header className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-4 py-2.5">
        <h3 className="font-display text-base font-semibold">{f.item}</h3>
        <Badge variant="outline">{KIND[f.kind]}{f.column ? ` · ${f.column}` : ""}</Badge>
        <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">Evidence strength <QualChip q={f.qualification} /></span>
      </header>
      <div className="grid gap-px bg-border md:grid-cols-2">
        <section className="space-y-2 bg-card p-4" aria-label="Quantitative evidence">
          <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-computed">Quantitative evidence <Provenance kind="computed" /></h4>
          <p className="text-sm leading-relaxed">{f.statement}</p>
          <dl className="flex flex-wrap gap-x-4 gap-y-1.5 pt-1">
            {Object.entries(f.numbers).filter(([k]) => k in LABEL).map(([k, v]) => (
              <div key={k}><dt className="text-[11px] text-muted-foreground">{LABEL[k]}</dt><dd className="tabular text-sm font-semibold">{fmtNum(k, v)}</dd></div>
            ))}
          </dl>
        </section>
        <section className="space-y-2 bg-card p-4" aria-label="Qualitative evidence">
          <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-qual">Qualitative evidence <Provenance kind="qualitative" label="Verbatim" /></h4>
          {item && <p className="text-sm text-muted-foreground"><span className="tabular font-medium text-foreground">{fmtNumber(item.n_respondents)}</span> respondents ({fmtPct(item.prevalence_pct)}) voiced this {item.kind}.</p>}
          {quotes.length ? <ul className="space-y-1.5">{quotes.map((q) => <li key={q} className="flex gap-2 text-sm"><Quote className="mt-0.5 size-3.5 shrink-0 text-qual" aria-hidden /><q>{q}</q></li>)}</ul> : <p className="text-sm text-muted-foreground">No stored quote for this item.</p>}
        </section>
      </div>
    </article>
  );
}
