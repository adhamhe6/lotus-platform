import { ArrowLeft, ArrowRight, Database, Lightbulb, Pencil, Sparkles, Star, Trash2, Check, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { ApiError } from "@/api/client";
import { useAnalysisTypes, useMembers, useProject } from "@/api/hooks";
import type { AnalysisDetail, AnalysisResult, Interpretation } from "@/api/types";
import { ChartView } from "@/components/charts/ChartView";
import { ErrorState, errorMessage, Section } from "@/components/common/blocks";
import { Provenance } from "@/components/common/Provenance";
import { AssumptionList, InterpretationCard, MetricGrid, ResultTable } from "@/components/results";
import { fmtDuration } from "@/components/results/format";
import { Alert } from "@/components/ui/alert";
import { ConfirmDialog } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtNumber, fmtRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { QualificationChip } from "@/features/insights/components/QualificationChip";
import { useInsights } from "@/features/insights/api";
import { useAnalysis, useDeleteAnalysis, useExplainAnalysis, useUpdateAnalysis, useVersionNames } from "./api";
import { builderLink, StatusChip, typeLabel } from "./labels";
import { ReproPanel } from "./components/ReproPanel";

export function AnalysisResultPage() {
  const { projectId: pid = "", analysisId = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const q = useAnalysis(analysisId);
  const { data: project } = useProject(pid);
  const canWrite = project?.role === "OWNER" || project?.role === "EDITOR";
  const { data: types } = useAnalysisTypes();
  const { data: members } = useMembers(pid);
  const names = useVersionNames(pid);
  const update = useUpdateAnalysis(pid);
  const remove = useDeleteAnalysis(pid);
  const explain = useExplainAnalysis(analysisId);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [explainError, setExplainError] = useState<{ message: string; limited: boolean } | null>(null);
  const a = q.data;
  const reused = (location.state as { reused?: boolean } | null)?.reused;

  if (q.isLoading) return <ResultSkeleton />;
  if (q.isError || !a) return <ErrorState error={q.error} onRetry={() => q.refetch()} title="Couldn’t load this analysis" />;

  const result = a.result as unknown as AnalysisResult | null;
  const interpretation = a.interpretation as unknown as Interpretation | null;
  const done = a.status === "COMPLETED" && !!result;
  const v = names.get(a.dataset_version_id);
  const creator = members?.find((m) => m.user_id === a.created_by)?.full_name;

  const runExplain = () => {
    setExplainError(null);
    explain.mutate(undefined, {
      onError: (e) => setExplainError({ message: errorMessage(e), limited: e instanceof ApiError && e.status === 429 }),
    });
  };

  return (
    <article className="space-y-8" aria-labelledby="analysis-title">
      <header className="space-y-3">
        <Link to={`/projects/${pid}/analysis`} className="inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3.5" aria-hidden />Analysis history</Link>
        {reused && <Alert variant="info">This exact analysis already exists — opened the saved result.</Alert>}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1 space-y-2">
            <TitleEditor title={a.title} editable={canWrite} saving={update.isPending} onSave={(title, done) => update.mutate({ id: a.id, title }, { onSuccess: done, onError: (e) => toast.error(errorMessage(e)) })} />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] text-muted-foreground">
              <StatusChip status={a.status} />
              <span>{typeLabel(types, a.analysis_type)}</span>
              <Link className="inline-flex items-center gap-1 hover:text-foreground hover:underline" to={v ? `/projects/${pid}/data/${v.datasetId}` : `/projects/${pid}/data`}>
                <Database className="size-3.5" aria-hidden />{a.dataset_name ?? v?.dataset ?? "Dataset"}{(a.version_number ?? v?.number) != null && ` · v${a.version_number ?? v?.number}`}
              </Link>
              {done && <span className="tabular">n = {fmtNumber(result.n_used)} of {fmtNumber(result.n_total)} rows used</span>}
              {a.duration_ms != null && <span className="tabular">{fmtDuration(a.duration_ms)}</span>}
              <span>{fmtRelative(a.created_at)}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canWrite && done && <Button onClick={runExplain} loading={explain.isPending} variant={interpretation ? "secondary" : "default"}><Sparkles />{interpretation ? "Explain again" : "Explain this result"}</Button>}
            <Button variant="secondary" aria-pressed={a.saved} disabled={!canWrite || update.isPending} onClick={() => update.mutate({ id: a.id, saved: !a.saved }, { onError: (e) => toast.error(errorMessage(e)) })}>
              <Star className={cn(a.saved && "fill-warning text-warning")} />{a.saved ? "Saved" : "Save to my analyses"}
            </Button>
            {canWrite && <Button variant="ghost" size="icon" aria-label="Delete this analysis" onClick={() => setConfirmDelete(true)}><Trash2 className="text-muted-foreground" /></Button>}
          </div>
        </div>
      </header>

      {(a.status === "PENDING" || a.status === "RUNNING") && <RunningState status={a.status} />}
      {a.status === "FAILED" && <FailedState a={a} pid={pid} canWrite={canWrite} />}

      {done && result && (
        <>
          <section aria-labelledby="metrics-h" className="space-y-3">
            <h2 id="metrics-h" className="sr-only">Key results</h2>
            <MetricGrid metrics={result.metrics} />
          </section>

          {result.warnings.length > 0 && (
            <Alert variant="warning" title={result.warnings.length === 1 ? "Warning" : `${result.warnings.length} warnings`}>
              <ul className="list-disc space-y-0.5 pl-4">{result.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
            </Alert>
          )}

          {result.charts.length > 0 && (
            <Section title="Charts" actions={<Provenance kind="computed" />}>
              <div className={cn("grid gap-4", result.charts.length > 1 && "lg:grid-cols-2")}>
                {result.charts.map((c, i) => <Card key={i} className="min-w-0 p-4"><ChartView spec={c} /></Card>)}
              </div>
            </Section>
          )}

          {result.tables.length > 0 && (
            <Section title="Tables" actions={<Provenance kind="computed" />}>
              <div className="space-y-6">{result.tables.map((t) => <ResultTable key={t.name} table={t} />)}</div>
            </Section>
          )}

          <Section title="Assumptions & diagnostics" description="Checks the engine ran before trusting the result. Violations don’t block the analysis but change how far you can rely on it.">
            <AssumptionList assumptions={result.assumptions} />
          </Section>

          {result.decisions.length > 0 && (
            <Section title="What Lotus decided" description="Choices the engine made on your behalf, and why.">
              <ul className="space-y-2 rounded-lg border bg-card px-4 py-3 text-sm">
                {result.decisions.map((d, i) => <li key={i} className="flex gap-2"><ArrowRight className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />{d}</li>)}
              </ul>
            </Section>
          )}

          <InterpretationSection
            interpretation={explain.data ?? interpretation} pending={explain.isPending} error={explainError} canExplain={canWrite} onExplain={runExplain} pid={pid}
          />

          <DerivedInsights pid={pid} analysisId={a.id} />

          <Section title="Methodology">
            <details className="group rounded-lg border bg-card">
              <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium hover:bg-muted/40">How this was computed</summary>
              <p className="whitespace-pre-line border-t px-4 py-3 text-sm leading-relaxed text-foreground/85">{result.methodology}</p>
            </details>
          </Section>
        </>
      )}

      <Section title="Reproducibility" description="Re-running this configuration on the same data version gives the same numbers.">
        <ReproPanel analysis={a} creator={creator} />
      </Section>

      <ConfirmDialog
        open={confirmDelete} onOpenChange={setConfirmDelete} title="Delete this analysis?" loading={remove.isPending}
        description={<>“{a.title}” and the insights derived from it will be permanently removed. This can’t be undone.</>}
        onConfirm={() => remove.mutate(a.id, { onSuccess: () => { toast.success("Analysis deleted"); navigate(`/projects/${pid}/analysis`); }, onError: (e) => toast.error(errorMessage(e)) })}
      />
    </article>
  );
}

function TitleEditor({ title, editable, saving, onSave }: { title: string; editable: boolean; saving: boolean; onSave: (t: string, done: () => void) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing) ref.current?.select(); }, [editing]);
  const commit = () => {
    const t = value.trim();
    if (!t || t === title) { setEditing(false); setValue(title); return; }
    onSave(t, () => setEditing(false));
  };
  if (!editing) {
    return (
      <div className="flex items-start gap-2">
        <h1 id="analysis-title" className="font-display text-[28px] font-semibold leading-tight">{title}</h1>
        {editable && <Button variant="ghost" size="icon-sm" aria-label="Edit title" onClick={() => { setValue(title); setEditing(true); }}><Pencil /></Button>}
      </div>
    );
  }
  return (
    <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); commit(); }}>
      <Input ref={ref} aria-label="Analysis title" value={value} maxLength={300} className="h-10 text-lg font-semibold" onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") { setEditing(false); setValue(title); } }} />
      <Button type="submit" size="icon" loading={saving} aria-label="Save title"><Check /></Button>
      <Button type="button" variant="ghost" size="icon" aria-label="Cancel editing" onClick={() => { setEditing(false); setValue(title); }}><X /></Button>
    </form>
  );
}

function RunningState({ status }: { status: string }) {
  return (
    <div className="space-y-4" aria-live="polite" aria-busy>
      <Alert variant="info" title={status === "PENDING" ? "Queued — waiting for a worker" : "Computing your analysis…"}>This page updates automatically as soon as the result is ready.</Alert>
      <div className="grid gap-3 sm:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24" />)}</div>
      <Skeleton className="h-64" />
    </div>
  );
}

function FailedState({ a, pid, canWrite }: { a: AnalysisDetail; pid: string; canWrite: boolean }) {
  const err = (a.error ?? {}) as { code?: string; message?: string };
  return (
    <Alert
      variant="error" title="This analysis couldn’t be completed"
      action={canWrite ? <Button asChild variant="secondary" size="sm"><Link to={builderLink(pid, { type: a.analysis_type, version: a.dataset_version_id, config: a.config })}>Edit configuration</Link></Button> : undefined}
    >
      <p>{err.message ?? "The engine reported an error without details."}</p>
      {err.code && <p className="mt-1 text-xs text-muted-foreground">Error code: <code className="font-mono">{err.code}</code></p>}
      <p className="mt-1 text-sm">Nothing was computed, so there are no numbers to interpret. Check the variables and settings, then run it again.</p>
    </Alert>
  );
}

function InterpretationSection({ interpretation, pending, error, canExplain, onExplain, pid }: {
  interpretation: Interpretation | null; pending: boolean; error: { message: string; limited: boolean } | null; canExplain: boolean; onExplain: () => void; pid: string;
}) {
  return (
    <section aria-labelledby="interp-h" className="space-y-3 rounded-2xl border-2 border-dashed border-border/80 bg-muted/20 p-4 sm:p-5">
      <div>
        <h2 id="interp-h" className="text-lg font-semibold">Plain-language explanation</h2>
        <p className="text-[13px] text-muted-foreground">Written from the computed results above. It is kept separate from them: the numbers never change, only the wording around them.</p>
      </div>
      {error && (
        <Alert variant={error.limited ? "warning" : "error"} title={error.limited ? "Slow down a moment" : "Couldn’t generate the explanation"}>
          {error.message}{error.limited && " You can try again in a few seconds."}
        </Alert>
      )}
      {pending ? <div className="space-y-2" aria-busy aria-label="Generating explanation"><Skeleton className="h-5 w-2/3" /><Skeleton className="h-4" /><Skeleton className="h-4 w-5/6" /></div>
        : interpretation ? <InterpretationCard interpretation={interpretation} projectId={pid} />
        : <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
            <span>{canExplain ? "No explanation yet. Ask for one to see the findings in plain language, with every statement linked to the evidence behind it." : "No explanation has been generated for this analysis yet."}</span>
            {canExplain && <Button variant="secondary" onClick={onExplain}><Sparkles />Explain this result</Button>}
          </div>}
    </section>
  );
}

function DerivedInsights({ pid, analysisId }: { pid: string; analysisId: string }) {
  const q = useInsights(pid, { analysis_run_id: analysisId });
  return (
    <Section title="Insights from this analysis" actions={<Button asChild variant="link" size="sm"><Link to={`/projects/${pid}/insights`}>All insights<ArrowRight /></Link></Button>}>
      {q.isLoading ? <Skeleton className="h-16" /> : q.isError ? <p className="text-sm text-muted-foreground">Couldn’t load derived insights. <button className="text-primary underline" onClick={() => q.refetch()}>Retry</button></p>
        : !q.data?.length ? <p className="rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">No insight was derived from this analysis. Insights appear only when an effect clears explicit thresholds (n ≥ 30, p &lt; 0.05 and a minimum effect size).</p>
        : (
          <ul className="divide-y rounded-lg border bg-card">
            {q.data.map((i) => (
              <li key={i.id} className="flex items-start gap-3 px-4 py-3">
                <Lightbulb className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                <div className="min-w-0 flex-1 space-y-1"><p className="text-sm font-medium">{i.title}</p><p className="text-[13px] text-muted-foreground">{i.statement}</p></div>
                <QualificationChip value={i.qualification} />
              </li>
            ))}
          </ul>
        )}
    </Section>
  );
}

function ResultSkeleton() {
  return (
    <div className="space-y-6" aria-busy aria-label="Loading analysis">
      <Skeleton className="h-8 w-2/3" /><Skeleton className="h-4 w-1/2" />
      <div className="grid gap-3 sm:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}</div>
      <Skeleton className="h-72" />
    </div>
  );
}
