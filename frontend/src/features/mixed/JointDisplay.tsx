import { CheckCircle2, ChevronDown, ChevronRight, CircleDashed, MinusCircle, AlertCircle } from "lucide-react";
import { Fragment, useState } from "react";
import { Provenance } from "@/components/common/Provenance";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { fmtNumber, fmtP, fmtPct } from "@/lib/format";
import { magnitude, type ByGroup, type Comparison, type MixedItem, type MixedResult } from "./api";

const f2 = (v: unknown) => fmtNumber(v, 2);
const ci = (c?: [number, number] | null) => (c ? `${f2(c[0])} to ${f2(c[1])}` : "—");

/** Text + icon status (never colour alone). */
export function StatusChip({ c }: { c: { status?: string; significant?: boolean } }) {
  if (c.status === "insufficient_n") return <Badge variant="outline"><MinusCircle className="size-3" aria-hidden />Insufficient n</Badge>;
  if (c.status === "constant") return <Badge variant="outline"><MinusCircle className="size-3" aria-hidden />No variation</Badge>;
  if (c.significant) return <Badge variant="success"><CheckCircle2 className="size-3" aria-hidden />Supported</Badge>;
  return <Badge variant="default"><CircleDashed className="size-3" aria-hidden />Not significant</Badge>;
}

function ComparisonRows({ rows }: { rows: Comparison[] }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">No comparison variables were included in this run.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <caption className="sr-only">Other measured variables, with vs without this item</caption>
        <thead><tr className="text-left text-xs text-muted-foreground">
          <th className="py-1 pr-3 font-semibold">Variable</th><th className="py-1 pr-3 text-right font-semibold">With</th><th className="py-1 pr-3 text-right font-semibold">Without</th>
          <th className="py-1 pr-3 text-right font-semibold">Hedges’ g</th><th className="py-1 pr-3 text-right font-semibold">Holm p</th><th className="py-1 font-semibold">Status</th></tr></thead>
        <tbody>{rows.map((c) => (
          <tr key={c.column} className="border-t">
            <td className="py-1.5 pr-3 font-medium">{c.column}</td>
            <td className="tabular py-1.5 pr-3 text-right">{f2(c.mean_with)}</td><td className="tabular py-1.5 pr-3 text-right">{f2(c.mean_without)}</td>
            <td className="tabular py-1.5 pr-3 text-right">{f2(c.effect)}</td><td className="tabular py-1.5 pr-3 text-right">{fmtP(c.p_adj)}</td>
            <td className="py-1.5"><StatusChip c={c} /></td>
          </tr>))}
        </tbody>
      </table>
    </div>
  );
}

function GroupBlock({ g }: { g: ByGroup }) {
  if (g.status !== "tested") return <p className="text-sm text-muted-foreground">Too few respondents per {g.column} level to test whether this item’s prevalence differs.</p>;
  return (
    <div className="space-y-2">
      <ul className="space-y-1" aria-label={`Share of respondents voicing this item, by ${g.column}`}>
        {Object.entries(g.rates).map(([level, r]) => (
          <li key={level} className="grid grid-cols-[minmax(80px,140px)_1fr_auto] items-center gap-2 text-sm">
            <span className="truncate">{level}</span>
            <span className="h-2 overflow-hidden rounded-full bg-muted" role="presentation"><span className="block h-full rounded-full bg-qual" style={{ width: `${Math.max(0, Math.min(100, r.pct))}%` }} /></span>
            <span className="tabular text-xs text-muted-foreground"><span className="font-medium text-foreground">{fmtPct(r.pct)}</span> ({r.voiced} of {r.n})</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        χ² test of difference across {g.column}: Holm-adjusted p <span className="tabular font-medium text-foreground">{fmtP(g.p_adj)}</span>, Cramér’s V <span className="tabular font-medium text-foreground">{f2(g.cramers_v)}</span> · <StatusChip c={g} />
      </p>
    </div>
  );
}

function Detail({ item, outcome }: { item: MixedItem; outcome: string }) {
  const quotes = [...new Set(item.quotes)];
  return (
    <div className="grid gap-5 p-4 lg:grid-cols-2">
      <div className="space-y-4">
        <section>
          <h4 className="mb-1.5 flex items-center gap-2 text-sm font-semibold">Qualitative evidence <Provenance kind="qualitative" label="Verbatim" /></h4>
          {quotes.length ? <ul className="space-y-1.5">{quotes.map((q) => <li key={q} className="border-l-2 border-qual/60 pl-2.5 text-sm"><q>{q}</q></li>)}</ul> : <p className="text-sm text-muted-foreground">No representative responses stored.</p>}
          <p className="mt-1.5 text-xs text-muted-foreground">Quoted as written. {item.n_respondents} respondents voiced this {item.kind}.</p>
        </section>
        {item.by_group && (
          <section>
            <h4 className="mb-1.5 flex items-center gap-2 text-sm font-semibold">Prevalence by {item.by_group.column} <Provenance kind="computed" /></h4>
            <GroupBlock g={item.by_group} />
          </section>
        )}
      </div>
      <section>
        <h4 className="mb-1.5 flex items-center gap-2 text-sm font-semibold">Convergence with other measures <Provenance kind="computed" /></h4>
        <p className="mb-1.5 text-xs text-muted-foreground">Do respondents voicing this {item.kind} also differ on the measured variables, in addition to {outcome}?</p>
        <ComparisonRows rows={item.comparisons} />
      </section>
    </div>
  );
}

export function JointDisplay({ result }: { result: MixedResult }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const o = result.overall.outcome;
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <Table className="min-w-[860px]">
        <caption className="sr-only">Joint display: each theme or code beside the outcome {o}, with versus without</caption>
        <THead>
          <TR className="hover:bg-transparent">
            <TH>Theme / code</TH><TH className="text-right">Respondents (prevalence)</TH><TH className="text-right">Mean {o}, with</TH><TH className="text-right">Mean {o}, without</TH>
            <TH className="text-right">Difference (95% CI)</TH><TH>Hedges’ g</TH><TH className="text-right">Holm p</TH><TH>Status</TH>
          </TR>
        </THead>
        <TBody>
          {result.items.map((it) => {
            const oc = it.outcome;
            const isOpen = open.has(it.id);
            return (
              <Fragment key={it.id}>
                <TR>
                  <TD>
                    <button type="button" aria-expanded={isOpen} aria-label={`${isOpen ? "Hide" : "Show"} details for ${it.name}`} onClick={() => toggle(it.id)} className="flex items-center gap-1.5 text-left font-medium">
                      {isOpen ? <ChevronDown className="size-4 shrink-0" aria-hidden /> : <ChevronRight className="size-4 shrink-0" aria-hidden />}
                      <span>{it.name}</span><Badge variant="outline">{it.kind}</Badge>
                    </button>
                  </TD>
                  <TD className="tabular text-right"><span className="font-medium">{fmtNumber(it.n_respondents)}</span> <span className="text-muted-foreground">({fmtPct(it.prevalence_pct)})</span></TD>
                  <TD className="tabular text-right">{f2(oc.mean_with)}<span className="block text-[11px] text-muted-foreground">n = {fmtNumber(oc.n_with)}</span></TD>
                  <TD className="tabular text-right">{f2(oc.mean_without)}<span className="block text-[11px] text-muted-foreground">n = {fmtNumber(oc.n_without)}</span></TD>
                  <TD className="tabular text-right">{f2(oc.diff)}<span className="block text-[11px] text-muted-foreground">{ci(oc.ci)}</span></TD>
                  <TD className="tabular">{f2(oc.effect)}<span className="block text-[11px] text-muted-foreground">{magnitude(oc.effect)}</span></TD>
                  <TD className="tabular text-right">{fmtP(oc.p_adj)}</TD>
                  <TD><StatusChip c={oc} /></TD>
                </TR>
                {isOpen && <tr className="border-b bg-muted/30"><td colSpan={8}><Detail item={it} outcome={o} /></td></tr>}
              </Fragment>
            );
          })}
        </TBody>
      </Table>
      <p className="flex items-start gap-1.5 border-t px-3 py-2 text-xs text-muted-foreground"><AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />Differences describe associations among respondents who wrote a response. They do not show that a topic causes the outcome. Rows are ordered by the size of the effect.</p>
    </div>
  );
}
