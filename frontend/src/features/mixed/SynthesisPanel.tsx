import { BrainCircuit, FileSearch } from "lucide-react";
import { useState } from "react";
import { ApiError } from "@/api/client";
import { errorMessage } from "@/components/common/blocks";
import { Provenance, interpretationKind } from "@/components/common/Provenance";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogTitle, Sheet, SheetContent } from "@/components/ui/dialog";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useSynthesize, type MixedRunView } from "./api";

function EvidenceDrawer({ run, focus, onClose }: { run: MixedRunView; focus: string | null; onClose: () => void }) {
  const items = run.synthesis?.evidence ?? [];
  return (
    <Sheet open={focus !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent width="max-w-lg">
        <DialogTitle className="font-display text-xl font-semibold">Evidence behind the interpretation</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">Every sentence of the interpretation cites these items. Numbers and quotes come from the computed analysis, not from the writer.</DialogDescription>
        <ol className="space-y-2.5">
          {items.map((e) => (
            <li key={e.id} id={`ev-${e.id}`} className={cn("rounded-lg border p-3", e.id === focus && "border-primary ring-1 ring-primary")} aria-current={e.id === focus || undefined}>
              <div className="mb-1 flex flex-wrap items-center gap-1.5"><Badge variant="outline">{e.id}</Badge><Badge variant={e.kind === "qualitative" ? "qual" : "computed"}>{e.kind}</Badge><span className="text-sm font-medium">{e.label}</span></div>
              <p className="text-sm leading-relaxed">{e.text}</p>
            </li>
          ))}
        </ol>
      </SheetContent>
    </Sheet>
  );
}

export function SynthesisPanel({ run, canWrite, pid }: { run: MixedRunView; canWrite: boolean; pid: string }) {
  const gen = useSynthesize(pid);
  const [focus, setFocus] = useState<string | null>(null);
  const s = run.synthesis;
  const kind = interpretationKind(s?.meta.origin);
  const limited = gen.error instanceof ApiError && gen.error.status === 429;
  return (
    <section className="space-y-3 rounded-xl border bg-card p-5" aria-labelledby="syn-h">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="syn-h" className="flex items-center gap-2 font-display text-lg font-semibold"><BrainCircuit className="size-4.5 text-ai" aria-hidden />Synthesis</h3>
          <p className="text-[13px] text-muted-foreground">Wording that reads the quantitative and qualitative evidence together. It adds no numbers of its own.</p>
        </div>
        {canWrite && <Button onClick={() => gen.mutate(run.id)} loading={gen.isPending} variant={s ? "secondary" : "default"}>{s ? "Regenerate interpretation" : "Generate integrated interpretation"}</Button>}
      </div>
      {gen.isError && <Alert variant={limited ? "warning" : "error"} title={limited ? "Please wait a moment" : "Couldn’t generate the interpretation"}>{errorMessage(gen.error)}</Alert>}
      {!s ? (
        <p className="rounded-lg border border-dashed bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">No interpretation has been generated for this run. The findings above stand on their own; the synthesis is an optional reading of them.</p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Provenance kind={kind} />
            {s.meta.origin === "llm" && s.meta.model && <Badge variant="outline">Model: {s.meta.model}</Badge>}
            <Badge variant={s.meta.validation.status === "passed" ? "success" : "outline"}>Validation: {s.meta.validation.status}</Badge>
            <span className="text-xs text-muted-foreground">Generated {fmtDate(s.meta.generated_at, true)}</span>
          </div>
          {s.meta.fallback_reason && <Alert variant="info" title="Rule-based text is shown">The AI interpretation was not used because: {s.meta.fallback_reason}</Alert>}
          {s.meta.validation.problems.length > 0 && <Alert variant="warning" title="Validation notes"><ul className="list-disc pl-4">{s.meta.validation.problems.map((p) => <li key={p}>{p}</li>)}</ul></Alert>}
          {s.summary && <p className="text-[15px] font-medium leading-relaxed">{s.summary}</p>}
          <ul className="space-y-2">
            {s.points.map((p, i) => (
              <li key={i} className="flex flex-wrap items-start gap-x-2 gap-y-1 text-sm leading-relaxed">
                <span className="min-w-0 flex-1">{p.text}</span>
                <span className="flex gap-1">{p.evidence.map((id) => <button key={id} type="button" onClick={() => setFocus(id)} aria-label={`Show evidence ${id}`} className="rounded border bg-muted px-1.5 text-[11px] font-semibold text-muted-foreground hover:bg-accent hover:text-accent-foreground">{id}</button>)}</span>
              </li>
            ))}
          </ul>
          {s.caveats.length > 0 && <div><h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Caveats</h4><ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">{s.caveats.map((c) => <li key={c}>{c}</li>)}</ul></div>}
          {s.next_steps && s.next_steps.length > 0 && <div><h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Suggested next steps</h4><ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">{s.next_steps.map((c) => <li key={c}>{c}</li>)}</ul></div>}
          <Button size="sm" variant="ghost" onClick={() => setFocus("")}><FileSearch />View all evidence</Button>
        </div>
      )}
      <EvidenceDrawer run={run} focus={focus} onClose={() => setFocus(null)} />
    </section>
  );
}
