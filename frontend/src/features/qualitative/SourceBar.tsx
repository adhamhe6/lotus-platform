import { FileText, Search, Sparkles, Wand2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { SimpleSelect } from "@/components/ui/select";
import { fmtDate, fmtNumber } from "@/lib/format";
import type { TextSource, ThemeRun } from "./api";

export interface ColumnOption { column: string; source?: TextSource; detected: boolean }

function DetectDialog({ open, onOpenChange, busy, onRun }: { open: boolean; onOpenChange: (o: boolean) => void; busy: boolean; onRun: (n?: number) => void }) {
  const [n, setN] = useState("");
  const [err, setErr] = useState<string>();
  const run = () => {
    if (n.trim() === "") { onRun(undefined); return; }
    const v = Number(n);
    if (!Number.isInteger(v) || v < 2 || v > 15) { setErr("Enter a whole number from 2 to 15, or leave it empty."); return; }
    onRun(v);
  };
  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (o) { setN(""); setErr(undefined); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Detect themes</DialogTitle>
          <DialogDescription>Lotus groups responses that use similar language and names each group from its most distinguishing terms. The result is a <strong>starting point to review</strong>: it can miss secondary topics because each response goes into only one group. Existing themes and your edits are kept; a new theme set is added beside them.</DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); run(); }} className="space-y-3" noValidate>
          <Field label="Number of themes (optional)" htmlFor="n-themes" error={err} hint="Leave empty and Lotus picks the number that separates the groups best (silhouette score).">
            <Input id="n-themes" inputMode="numeric" value={n} onChange={(e) => setN(e.target.value)} placeholder="Automatic" aria-invalid={!!err} />
          </Field>
          <DialogFooter><Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" loading={busy}><Wand2 />Detect themes</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function SourceBar({ options, column, onColumn, prepared, source, canWrite, runs, runId, onRun, onPrepare, preparing, onDetect, detecting, exploring, onExplore }: {
  options: ColumnOption[]; column?: string; onColumn: (c: string) => void; prepared: boolean; source?: TextSource; canWrite: boolean;
  runs: ThemeRun[]; runId?: string; onRun: (id: string) => void; onPrepare: () => void; preparing: boolean;
  onDetect: (n?: number) => Promise<void>; detecting: boolean; exploring: boolean; onExplore: () => void;
}) {
  const [detect, setDetect] = useState(false);
  const run = runs.find((r) => r.id === runId) ?? runs[0];
  return (
    <div className="space-y-3 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full min-w-[200px] sm:w-64">
          <Field label="Text column" htmlFor="q-col">
            <SimpleSelect id="q-col" value={column} onValueChange={onColumn} placeholder="Choose a column"
              options={options.map((o) => ({ value: o.column, label: o.column, hint: o.source?.segments ? "prepared" : o.detected ? "needs preparing" : "not detected as text" }))} />
          </Field>
        </div>
        {prepared && runs.length > 0 && (
          <div className="w-full min-w-[200px] sm:w-72">
            <Field label="Theme set" htmlFor="q-run">
              <SimpleSelect id="q-run" value={run?.id} onValueChange={onRun} options={runs.map((r, i) => ({ value: r.id, label: `${i === 0 ? "Latest" : "Earlier"} · ${fmtDate(r.created_at, true)}`, hint: r.k != null ? `${r.k} themes` : undefined }))} />
            </Field>
          </div>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {prepared && <Button variant={exploring ? "accent" : "secondary"} aria-pressed={exploring} onClick={onExplore}><Search />Search &amp; keywords</Button>}
          {canWrite && prepared && <Button onClick={() => setDetect(true)} loading={detecting}><Wand2 />Detect themes</Button>}
          {canWrite && column && !prepared && <Button onClick={onPrepare} loading={preparing}><Sparkles />Prepare text</Button>}
        </div>
      </div>
      {prepared && source && (
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1"><FileText className="size-3.5" aria-hidden /><span className="tabular font-medium text-foreground">{fmtNumber(source.segments)}</span> segments prepared{source.non_empty != null && <> from <span className="tabular font-medium text-foreground">{fmtNumber(source.non_empty)}</span> non-empty responses</>}</span>
          {run && (
            <>
              <span>Theme set: <span className="tabular font-medium text-foreground">{run.k ?? "—"}</span> themes</span>
              {run.silhouette != null && <span title="How cleanly the groups separate, from -1 to 1. Low values mean overlapping themes.">Silhouette <span className="tabular font-medium text-foreground">{fmtNumber(run.silhouette, 2)}</span></span>}
              {run.embedding_model && <span>Model <span className="font-mono text-[11px] text-foreground">{run.embedding_model}</span></span>}
              {run.unassigned != null && <span><span className="tabular font-medium text-foreground">{fmtNumber(run.unassigned)}</span> unassigned</span>}
            </>
          )}
        </p>
      )}
      <DetectDialog open={detect} onOpenChange={setDetect} busy={detecting} onRun={async (n) => { await onDetect(n); setDetect(false); }} />
    </div>
  );
}
