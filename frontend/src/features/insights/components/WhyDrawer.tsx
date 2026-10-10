import { ArrowDown } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAnalysisTypes } from "@/api/hooks";
import type { Insight } from "@/api/types";
import { Provenance } from "@/components/common/Provenance";
import { Badge } from "@/components/ui/badge";
import { DialogDescription, DialogTitle, Sheet, SheetContent } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useAnalysis } from "@/features/analysis/api";
import { StatusChip, typeLabel } from "@/features/analysis/labels";
import { EvidenceStrip } from "./EvidenceStrip";
import { QualificationChip } from "./QualificationChip";

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="relative space-y-1.5 rounded-lg border bg-card p-3.5">
      <div className="flex items-center gap-2"><span className="flex size-5 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground tabular" aria-hidden>{n}</span><h3 className="text-sm font-semibold">{title}</h3></div>
      <div className="space-y-1.5 text-[13px]">{children}</div>
    </li>
  );
}
const Arrow = () => <li aria-hidden className="flex justify-center text-muted-foreground"><ArrowDown className="size-4" /></li>;

/** Insight → supporting analysis → variables → dataset version → evidence: the audit trail behind one statement. */
export function WhyDrawer({ insight, pid, open, onOpenChange }: { insight: Insight; pid: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const run = useAnalysis(insight.analysis_run_id ?? "", open && !!insight.analysis_run_id);
  const { data: types } = useAnalysisTypes();
  const a = run.data;
  const hash = (a?.provenance as { dataset_content_hash?: string } | undefined)?.dataset_content_hash;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent width="max-w-xl" aria-describedby="why-desc">
        <div className="space-y-1 pr-6">
          <DialogTitle>Why this insight?</DialogTitle>
          <DialogDescription id="why-desc">Every insight is derived by fixed rules from a stored analysis. Follow the chain from the statement back to the data.</DialogDescription>
        </div>
        <ol className="space-y-2">
          <Step n={1} title="Insight">
            <p className="font-medium">{insight.title}</p>
            <div className="flex flex-wrap items-center gap-2"><QualificationChip value={insight.qualification} /><Provenance kind="computed" /></div>
            <p className="text-muted-foreground">{insight.statement}</p>
          </Step>
          <Arrow />
          <Step n={2} title="Supporting analysis">
            {insight.analysis_run_id ? (run.isLoading ? <Skeleton className="h-16" /> : a ? (
              <>
                <Link className="font-medium text-primary hover:underline" to={`/projects/${pid}/analysis/${a.id}`}>{a.title}</Link>
                <div className="flex flex-wrap items-center gap-2 text-muted-foreground"><span>{typeLabel(types, a.analysis_type)}</span><StatusChip status={a.status} /></div>
                <dl className="grid gap-x-3 gap-y-0.5 sm:grid-cols-[auto_1fr]">
                  {Object.entries(a.config).map(([k, v]) => <div key={k} className="contents"><dt className="text-muted-foreground">{k.replace(/_/g, " ")}</dt><dd className="break-words font-mono text-xs">{Array.isArray(v) ? v.join(", ") : String(v)}</dd></div>)}
                </dl>
              </>
            ) : <p className="text-muted-foreground">The analysis behind this insight is no longer available.</p>)
              : insight.mixed_run_id ? <p>A mixed-methods run that links open-ended responses to measured variables. <Link className="font-medium text-primary hover:underline" to={`/projects/${pid}/mixed`}>Open mixed methods</Link></p>
              : <p className="text-muted-foreground">No source analysis is recorded for this insight.</p>}
          </Step>
          <Arrow />
          <Step n={3} title="Variables">
            {insight.variables.length ? <ul className="flex flex-wrap gap-1.5">{insight.variables.map((v) => <li key={String(v)}><Badge variant="outline" className="font-mono">{String(v)}</Badge></li>)}</ul> : <p className="text-muted-foreground">No variables recorded.</p>}
          </Step>
          <Arrow />
          <Step n={4} title="Dataset version">
            {a ? (
              <>
                <p>{a.dataset_name ?? "Dataset"}{a.version_number != null && ` · v${a.version_number}`}{a.version_label && <span className="text-muted-foreground"> — {a.version_label}</span>}</p>
                {hash && <p className="text-muted-foreground">Content hash <code className="break-all font-mono text-xs">{hash}</code></p>}
              </>
            ) : <p className="text-muted-foreground">{run.isLoading ? "Loading…" : "Not available for this insight."}</p>}
          </Step>
          <Arrow />
          <Step n={5} title="Evidence values"><EvidenceStrip evidence={insight.evidence} stacked /></Step>
        </ol>
      </SheetContent>
    </Sheet>
  );
}
