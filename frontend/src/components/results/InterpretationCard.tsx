import { ArrowRight, Info, ListChecks, ShieldAlert } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { Interpretation } from "@/api/types";
import { interpretationKind, Provenance } from "@/components/common/Provenance";
import { Badge } from "@/components/ui/badge";
import { DialogDescription, DialogTitle, Sheet, SheetContent } from "@/components/ui/dialog";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const VALIDATION: Record<string, { label: string; variant: "success" | "warning" | "destructive" | "outline"; tip: string }> = {
  passed: { label: "Numbers validated", variant: "success", tip: "Every number in the text was checked against the computed evidence." },
  passed_with_edits: { label: "Validated with edits", variant: "warning", tip: "Some statements were removed or corrected because they did not match the computed evidence." },
  failed: { label: "Validation failed", variant: "destructive", tip: "The text did not match the computed evidence." },
  skipped: { label: "Template text", variant: "outline", tip: "No language model was used, so there was nothing to validate: the text is assembled from the computed facts." },
};

/** AI / rule-based interpretation. Always labelled, always traceable: each point links to the evidence items that support it. */
export function InterpretationCard({ interpretation, title = "Interpretation", actions, className, projectId }: {
  interpretation: Interpretation; title?: string; actions?: ReactNode; className?: string; projectId?: string;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);
  const meta = interpretation.meta;
  const kind = interpretationKind(meta?.origin);
  const val = VALIDATION[meta?.validation?.status ?? "skipped"] ?? VALIDATION.skipped;
  const evidence = interpretation.evidence ?? [];
  const known = new Set(evidence.map((e) => e.id));
  const open = (id: string) => { setOpenId(id); setDrawer(true); };

  return (
    <section aria-label={title} className={cn("rounded-xl border bg-card", kind === "ai" ? "border-ai/30" : "border-rule/30", className)}>
      <header className="flex flex-wrap items-center gap-2 border-b px-5 py-3">
        <h3 className="mr-auto font-display text-lg font-semibold">{title}</h3>
        <Provenance kind={kind} />
        {meta?.origin === "llm" && meta.model && <Badge variant="outline">{meta.model}</Badge>}
        {meta?.prompt_version && <Badge variant="outline">Prompt {meta.prompt_version}</Badge>}
        <Badge variant={val.variant} title={val.tip}>{val.label}</Badge>
        {actions}
      </header>
      <div className="space-y-5 px-5 py-4">
        {meta?.fallback_reason && (
          <div className="flex gap-2 rounded-lg border border-warning/30 bg-warning-bg px-3 py-2 text-sm" role="note">
            <Info className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            <p><span className="font-medium">Why this is a rule-based summary: </span>{meta.fallback_reason}</p>
          </div>
        )}
        {meta?.validation?.problems?.length > 0 && (
          <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">{meta.validation.problems.map((p, i) => <li key={i}>{p}</li>)}</ul>
        )}
        <p className="text-[15px] leading-relaxed">{interpretation.summary}</p>

        {interpretation.points?.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">What the evidence shows</h4>
            <ul className="space-y-3">
              {interpretation.points.map((pt, i) => (
                <li key={i} className="flex gap-2.5 text-sm leading-relaxed">
                  <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                  <div className="min-w-0 space-y-1">
                    <p>{pt.text}</p>
                    {pt.evidence?.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Supporting evidence">
                        {pt.evidence.map((id) => known.has(id)
                          ? <button key={id} type="button" onClick={() => open(id)} aria-label={`Show evidence ${id}`} className="rounded-md border bg-muted px-1.5 py-0.5 font-mono text-[11px] font-medium text-foreground/80 hover:border-primary hover:text-primary">{id}</button>
                          : <span key={id} className="rounded-md border border-dashed px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">{id}</span>)}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {interpretation.caveats?.length > 0 && (
          <div className="space-y-1.5">
            <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><ShieldAlert className="size-3.5" aria-hidden />Caveats</h4>
            <ul className="list-disc space-y-1 pl-5 text-sm">{interpretation.caveats.map((c, i) => <li key={i}>{c}</li>)}</ul>
          </div>
        )}
        {interpretation.next_steps?.length > 0 && (
          <div className="space-y-1.5">
            <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><ListChecks className="size-3.5" aria-hidden />Suggested next steps</h4>
            <ul className="space-y-1 text-sm">{interpretation.next_steps.map((c, i) => <li key={i} className="flex gap-2"><ArrowRight className="mt-1 size-3.5 shrink-0 text-primary" aria-hidden />{c}</li>)}</ul>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
          <span>{meta?.generated_at ? `Generated ${fmtDate(meta.generated_at, true)}` : ""}{evidence.length > 0 && ` · ${evidence.length} evidence items`}</span>
          {evidence.length > 0 && <button type="button" className="font-medium text-primary hover:underline" onClick={() => { setOpenId(null); setDrawer(true); }}>View all evidence</button>}
        </div>
      </div>

      <Sheet open={drawer} onOpenChange={setDrawer}>
        <SheetContent width="max-w-lg" aria-describedby="evidence-desc">
          <div className="space-y-1 pr-6">
            <DialogTitle>Evidence</DialogTitle>
            <DialogDescription id="evidence-desc">Computed facts the statements above are built from. Nothing here is generated text.</DialogDescription>
          </div>
          <ol className="space-y-3">
            {evidence.map((e) => (
              <li key={e.id} data-selected={e.id === openId || undefined} className={cn("space-y-1.5 rounded-lg border p-3", e.id === openId && "border-primary bg-accent/40")}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] font-semibold">{e.id}</span>
                  <Provenance kind={e.kind === "qualitative" ? "qualitative" : "computed"} label={e.kind === "qualitative" ? "Qualitative" : "Computed"} />
                  <span className="text-sm font-medium">{e.label}</span>
                </div>
                <p className="text-[13px] leading-relaxed text-foreground/90">{e.text}</p>
                {projectId && typeof e.source?.analysis_run_id === "string" && (
                  <Link className="text-xs font-medium text-primary hover:underline" to={`/projects/${projectId}/analysis/${e.source.analysis_run_id}`}>Open source analysis</Link>
                )}
              </li>
            ))}
          </ol>
        </SheetContent>
      </Sheet>
    </section>
  );
}
