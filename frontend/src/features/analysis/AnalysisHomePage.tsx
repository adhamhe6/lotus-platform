import { ArrowRight, BarChart3, Lightbulb, Plus, SearchX, Star, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { useAnalysisTypes, useProject } from "@/api/hooks";
import type { AnalysisSummary } from "@/api/types";
import { EmptyState, ErrorState, errorMessage, PageHeader, SkeletonRows } from "@/components/common/blocks";
import { fmtDuration } from "@/components/results/format";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { SimpleSelect } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useActiveDataset } from "@/lib/activeDataset";
import { fmtRelative } from "@/lib/format";
import { useProjectId } from "@/lib/useProjectId";
import { cn } from "@/lib/utils";
import { useAnalysisList, useDeleteAnalysis, useSuggestions, useUpdateAnalysis, useVersionNames } from "./api";
import { builderLink, headlineText, StatusChip, typeLabel } from "./labels";

const PAGE_SIZE = 10;
const ALL = "all";
const STATUSES = [{ value: ALL, label: "Any status" }, { value: "COMPLETED", label: "Completed" }, { value: "FAILED", label: "Failed" }, { value: "RUNNING", label: "Running" }, { value: "PENDING", label: "Queued" }];

export function AnalysisHomePage() {
  const pid = useProjectId();
  const { data: project } = useProject(pid);
  const canWrite = project?.role === "OWNER" || project?.role === "EDITOR";
  const { dataset, version } = useActiveDataset();
  const { data: types } = useAnalysisTypes();
  const names = useVersionNames(pid);

  const [type, setType] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [versionId, setVersionId] = useState(ALL);
  const [savedOnly, setSavedOnly] = useState(false);
  const [page, setPage] = useState(1);
  const filtered = type !== ALL || status !== ALL || versionId !== ALL || savedOnly;
  const reset = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); };

  const list = useAnalysisList(pid, {
    page, page_size: PAGE_SIZE,
    ...(type !== ALL && { analysis_type: type }), ...(status !== ALL && { status }), ...(versionId !== ALL && { dataset_version_id: versionId }), ...(savedOnly && { saved: true }),
  });
  const update = useUpdateAnalysis(pid);
  const remove = useDeleteAnalysis(pid);
  const [toDelete, setToDelete] = useState<AnalysisSummary | null>(null);
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.page_size)) : 1;

  const versionOptions = [{ value: ALL, label: "All dataset versions" }, ...[...names].map(([id, n]) => ({ value: id, label: `${n.dataset} · v${n.number}` }))];

  return (
    <div>
      <PageHeader
        eyebrow="Analysis"
        title="Analysis history"
        description="Every analysis is computed from a specific dataset version, with its configuration, assumptions and provenance stored so it can be reproduced."
        actions={canWrite && <Button asChild size="lg"><Link to={`/projects/${pid}/analysis/new`}><Plus />New analysis</Link></Button>}
      />

      {canWrite && <SuggestionStrip pid={pid} datasetId={dataset?.id} versionId={version?.id} datasetName={dataset?.name} />}

      <div className="mb-4 flex flex-wrap items-end gap-3" role="search" aria-label="Filter analyses">
        <div className="w-full min-[480px]:w-52 space-y-1.5"><Label htmlFor="f-type">Type</Label>
          <SimpleSelect id="f-type" value={type} onValueChange={reset(setType)} options={[{ value: ALL, label: "All types" }, ...(types ?? []).map((t) => ({ value: t.type, label: t.label }))]} /></div>
        <div className="w-full min-[480px]:w-44 space-y-1.5"><Label htmlFor="f-status">Status</Label>
          <SimpleSelect id="f-status" value={status} onValueChange={reset(setStatus)} options={STATUSES} /></div>
        <div className="w-full min-[480px]:w-64 space-y-1.5"><Label htmlFor="f-version">Dataset version</Label>
          <SimpleSelect id="f-version" value={versionId} onValueChange={reset(setVersionId)} options={versionOptions} /></div>
        <div className="flex h-9 items-center gap-2"><Switch id="f-saved" checked={savedOnly} onCheckedChange={reset(setSavedOnly)} /><Label htmlFor="f-saved">Saved only</Label></div>
        {filtered && <Button variant="ghost" size="sm" onClick={() => { setType(ALL); setStatus(ALL); setVersionId(ALL); setSavedOnly(false); setPage(1); }}>Clear filters</Button>}
      </div>

      {list.isLoading ? <SkeletonRows n={5} />
        : list.isError ? <ErrorState error={list.error} onRetry={() => list.refetch()} title="Couldn’t load the analysis history" />
        : list.data && list.data.items.length === 0 ? (
          filtered
            ? <EmptyState icon={<SearchX />} title="No analyses match these filters" description="Try a different type, status or dataset version." action={<Button variant="secondary" onClick={() => { setType(ALL); setStatus(ALL); setVersionId(ALL); setSavedOnly(false); }}>Clear filters</Button>} />
            : <EmptyState icon={<BarChart3 />} title="No analyses yet" description="No analyses yet. Select a dataset and start exploring." action={canWrite ? <Button asChild><Link to={`/projects/${pid}/analysis/new`}><Plus />New analysis</Link></Button> : undefined} />
        ) : (
          <>
            <ul className={cn("divide-y rounded-xl border bg-card", list.isPlaceholderData && "opacity-60")} aria-label="Analyses">
              {list.data?.items.map((a) => {
                const v = names.get(a.dataset_version_id);
                const headline = headlineText(a.headline);
                return (
                  <li key={a.id} className="flex items-start gap-3 px-4 py-3.5">
                    <button
                      type="button" disabled={!canWrite || update.isPending} aria-pressed={a.saved}
                      aria-label={a.saved ? `Remove “${a.title}” from saved analyses` : `Save “${a.title}” to my analyses`}
                      onClick={() => update.mutate({ id: a.id, saved: !a.saved }, { onError: (e) => toast.error(errorMessage(e)) })}
                      className="mt-0.5 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-default disabled:hover:bg-transparent"
                    >
                      <Star className={cn("size-4", a.saved && "fill-warning text-warning")} aria-hidden />
                    </button>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                        <Link to={`/projects/${pid}/analysis/${a.id}`} className="min-w-0 break-words text-[15px] font-semibold leading-snug hover:text-primary hover:underline">{a.title}</Link>
                        <StatusChip status={a.status} />
                      </div>
                      <p className="text-[13px] text-muted-foreground">
                        {typeLabel(types, a.analysis_type)}{v ? ` · ${v.dataset} · v${v.number}` : ""} · {fmtRelative(a.created_at)}{a.duration_ms != null && ` · ${fmtDuration(a.duration_ms)}`}
                      </p>
                      {a.status === "FAILED" && a.error?.message ? <p className="text-[13px] text-destructive">{String(a.error.message)}</p>
                        : headline && <p className="tabular text-sm font-medium" aria-label="Headline result">{headline}</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button asChild variant="secondary" size="sm"><Link to={`/projects/${pid}/analysis/${a.id}`}>Open<span className="sr-only"> {a.title}</span></Link></Button>
                      {canWrite && <Button variant="ghost" size="icon-sm" aria-label={`Delete “${a.title}”`} onClick={() => setToDelete(a)}><Trash2 className="text-muted-foreground" /></Button>}
                    </div>
                  </li>
                );
              })}
            </ul>
            <nav className="mt-4 flex items-center justify-between gap-3 text-sm" aria-label="Pagination">
              <span className="text-muted-foreground" aria-live="polite">{list.data?.total} {list.data?.total === 1 ? "analysis" : "analyses"} · Page {page} of {pages}</span>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
                <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
              </div>
            </nav>
          </>
        )}

      <ConfirmDialog
        open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)} title="Delete this analysis?" loading={remove.isPending}
        description={<>“{toDelete?.title}” and the insights derived from it will be permanently removed. This can’t be undone.</>}
        onConfirm={() => toDelete && remove.mutate(toDelete.id, { onSuccess: () => { toast.success("Analysis deleted"); setToDelete(null); }, onError: (e) => toast.error(errorMessage(e)) })}
      />
    </div>
  );
}

function SuggestionStrip({ pid, datasetId, versionId, datasetName }: { pid: string; datasetId?: string; versionId?: string; datasetName?: string }) {
  const { data, isLoading, isError } = useSuggestions(datasetId, versionId);
  if (!datasetId) return null;
  if (isError || (!isLoading && !data?.length)) return null;
  return (
    <section aria-labelledby="sugg-h" className="mb-6 space-y-3">
      <div className="flex items-end justify-between gap-2">
        <div>
          <h2 id="sugg-h" className="flex items-center gap-2 text-lg font-semibold"><Lightbulb className="size-4 text-primary" aria-hidden />Suggested for your data</h2>
          <p className="text-[13px] text-muted-foreground">Starting points found by a quick scan of {datasetName ?? "the active dataset"}. Each opens pre-filled so you can review before running.</p>
        </div>
      </div>
      {isLoading ? <div className="flex gap-3 overflow-hidden" aria-busy aria-label="Loading suggestions">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-28 w-64 shrink-0" />)}</div> : (
        <ul className="scroll-thin -mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2">
          {data?.map((s, i) => (
            <li key={i} className="w-72 shrink-0 snap-start">
              <Link to={builderLink(pid, { type: s.analysis_type, version: versionId, config: s.config })} className="group flex h-full flex-col justify-between gap-3 rounded-lg border bg-card p-4 shadow-xs transition-colors hover:border-primary">
                <div className="space-y-1"><p className="text-sm font-semibold leading-snug">{s.title}</p><p className="line-clamp-3 text-xs text-muted-foreground">{s.reason}</p></div>
                <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">Set up this analysis<ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden /></span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
