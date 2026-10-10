import { Lightbulb, Pin, PinOff, RefreshCw, SearchX, Sparkles, Trash2, Waypoints } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { qk, TERMINAL, useJobQuery, useProject } from "@/api/hooks";
import type { Insight } from "@/api/types";
import { EmptyState, ErrorState, errorMessage, PageHeader, SkeletonCards } from "@/components/common/blocks";
import { JobProgressView } from "@/components/common/JobProgress";
import { Provenance } from "@/components/common/Provenance";
import { InterpretationCard } from "@/components/results";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { SimpleSelect } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useJobs } from "@/lib/jobs";
import { fmtRelative, titleCase } from "@/lib/format";
import { useProjectId } from "@/lib/useProjectId";
import { cn } from "@/lib/utils";
import { asInterpretation, useDeleteInsight, useGenerateInsights, useInsights, useNarrateInsight, usePinInsight } from "./api";
import { EvidenceStrip } from "./components/EvidenceStrip";
import { QualificationChip } from "./components/QualificationChip";
import { WhyDrawer } from "./components/WhyDrawer";

const ALL = "all";
const KINDS = [
  { value: ALL, label: "All kinds" }, { value: "association", label: "Association" }, { value: "group_difference", label: "Group difference" },
  { value: "driver", label: "Driver" }, { value: "trend", label: "Trend" }, { value: "mixed", label: "Mixed methods" },
];
const kindLabel = (k: string) => KINDS.find((x) => x.value === k)?.label ?? titleCase(k);

export function InsightsPage() {
  const pid = useProjectId();
  const { data: project } = useProject(pid);
  const canWrite = project?.role === "OWNER" || project?.role === "EDITOR";
  const [kind, setKind] = useState(ALL);
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const filtered = kind !== ALL || pinnedOnly;
  const q = useInsights(pid, { ...(kind !== ALL && { kind }), ...(pinnedOnly && { pinned: true }) });
  const generate = useGenerateInsights(pid);
  const { track } = useJobs();
  const [regenJob, setRegenJob] = useState<string | null>(null);

  const clearRegen = useCallback(() => setRegenJob(null), []);
  const rederive = () => generate.mutate(undefined, {
    onSuccess: (job) => { setRegenJob(job.id); track(job, { title: "Re-deriving insights", invalidate: [qk.insights(pid)] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div>
      <PageHeader
        eyebrow="Insights"
        title="Insights"
        description="Findings that cleared explicit evidence thresholds. Each one states what was measured, how strong it is and where it came from — so you can check it rather than trust it."
        actions={canWrite && <Button variant="secondary" onClick={rederive} loading={generate.isPending}><RefreshCw />Re-derive insights</Button>}
      />
      {regenJob && <RegenStatus jobId={regenJob} onDone={clearRegen} />}

      <div className="mb-4 flex flex-wrap items-end gap-4" role="search" aria-label="Filter insights">
        <div className="w-full space-y-1.5 min-[480px]:w-52"><Label htmlFor="i-kind">Kind</Label><SimpleSelect id="i-kind" value={kind} onValueChange={setKind} options={KINDS} /></div>
        <div className="flex h-9 items-center gap-2"><Switch id="i-pinned" checked={pinnedOnly} onCheckedChange={setPinnedOnly} /><Label htmlFor="i-pinned">Pinned only</Label></div>
      </div>

      {q.isLoading ? <SkeletonCards n={4} className="lg:grid-cols-1" />
        : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} title="Couldn’t load insights" />
        : !q.data?.length ? (
          filtered
            ? <EmptyState icon={<SearchX />} title="No insights match these filters" action={<Button variant="secondary" onClick={() => { setKind(ALL); setPinnedOnly(false); }}>Clear filters</Button>} />
            : (
              <EmptyState
                icon={<Lightbulb />} title="No insights generated yet"
                description={<>
                  <span className="block">No insights generated yet. Run an analysis to uncover patterns.</span>
                  <span className="mt-2 block">Insights appear only when an effect clears explicit thresholds — at least 30 observations, p &lt; 0.05 and a minimum effect size. Lotus deliberately doesn’t turn noise into insights, so an empty page can be the honest answer.</span>
                </>}
                action={<div className="flex flex-wrap justify-center gap-2">
                  {canWrite && <Button asChild><Link to={`/projects/${pid}/analysis/new`}>New analysis</Link></Button>}
                  {canWrite && <Button variant="secondary" onClick={rederive} loading={generate.isPending}><RefreshCw />Re-derive insights</Button>}
                </div>}
              />
            )
        ) : (
          <ul className={cn("space-y-4", q.isPlaceholderData && "opacity-60")} aria-label="Insights">
            {q.data.map((i) => <li key={i.id}><InsightCard insight={i} pid={pid} canWrite={canWrite} /></li>)}
          </ul>
        )}
    </div>
  );
}

function RegenStatus({ jobId, onDone }: { jobId: string; onDone: () => void }) {
  const { data } = useJobQuery(jobId);
  const finished = !!data && TERMINAL.has(data.status);
  useEffect(() => {
    if (!finished) return;
    const t = setTimeout(onDone, 2500);
    return () => clearTimeout(t);
  }, [finished, onDone]);
  if (!data) return null;
  return <div className="mb-4 rounded-lg border bg-card px-4 py-3"><JobProgressView job={data} /></div>;
}

function InsightCard({ insight: i, pid, canWrite }: { insight: Insight; pid: string; canWrite: boolean }) {
  const pin = usePinInsight(pid);
  const narrate = useNarrateInsight(pid);
  const remove = useDeleteInsight(pid);
  const [why, setWhy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const narrative = asInterpretation(i.narrative);
  const src = i.source as { title?: string; analysis_type?: string } | null;
  const titleId = `insight-${i.id}`;

  return (
    <article aria-labelledby={titleId} className={cn("rounded-xl border bg-card shadow-xs", i.pinned && "border-primary/40")}>
      <div className="space-y-4 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{kindLabel(i.kind)}</span>
          <QualificationChip value={i.qualification} />
          {i.pinned && <Badge variant="primary"><Pin className="size-3" aria-hidden />Pinned</Badge>}
          <div className="ml-auto flex items-center gap-1">
            {canWrite && (
              <Button variant="ghost" size="icon-sm" aria-pressed={i.pinned} aria-label={i.pinned ? `Unpin “${i.title}”` : `Pin “${i.title}”`} loading={pin.isPending}
                onClick={() => pin.mutate({ id: i.id, pinned: !i.pinned }, { onError: (e) => toast.error(errorMessage(e)) })}>
                {i.pinned ? <PinOff /> : <Pin />}
              </Button>
            )}
            {canWrite && <Button variant="ghost" size="icon-sm" aria-label={`Delete “${i.title}”`} onClick={() => setConfirm(true)}><Trash2 className="text-muted-foreground" /></Button>}
          </div>
        </div>

        <div className="space-y-2">
          <h2 id={titleId} className="font-display text-xl font-semibold leading-snug">{i.title}</h2>
          <p className="text-[15px] leading-relaxed">{i.statement}</p>
          <Provenance kind="computed" />
        </div>

        <div className="rounded-lg bg-muted/50 px-4 py-3"><EvidenceStrip evidence={i.evidence} /></div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-muted-foreground">
          {i.variables.length > 0 && <ul className="flex flex-wrap gap-1.5" aria-label="Variables">{i.variables.map((v) => <li key={String(v)}><Badge variant="outline" className="font-mono">{String(v)}</Badge></li>)}</ul>}
          {i.analysis_run_id ? <Link className="hover:text-foreground hover:underline" to={`/projects/${pid}/analysis/${i.analysis_run_id}`}>Source: {src?.title ?? "analysis"}</Link>
            : i.mixed_run_id ? <Link className="hover:text-foreground hover:underline" to={`/projects/${pid}/mixed`}>Source: mixed-methods run</Link> : null}
          <span>{fmtRelative(i.created_at)}</span>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => setWhy(true)}><Waypoints />Why this insight?</Button>
          {canWrite && (
            <Button variant="secondary" size="sm" loading={narrate.isPending}
              onClick={() => narrate.mutate(i.id, { onError: (e) => toast.error(errorMessage(e)) })}>
              <Sparkles />{narrative ? "Regenerate interpretation" : "Generate AI interpretation"}
            </Button>
          )}
        </div>
      </div>

      {narrative && (
        <div className="border-t bg-muted/20 p-4">
          <p className="mb-2 text-xs text-muted-foreground">Wording below is separate from the computed statement above.</p>
          <InterpretationCard interpretation={narrative} title="Interpretation" projectId={pid} />
        </div>
      )}

      <WhyDrawer insight={i} pid={pid} open={why} onOpenChange={setWhy} />
      <ConfirmDialog
        open={confirm} onOpenChange={setConfirm} title="Delete this insight?" loading={remove.isPending}
        description="The insight is removed from the feed. The analysis behind it stays, and re-deriving insights can bring it back."
        onConfirm={() => remove.mutate(i.id, { onSuccess: () => { toast.success("Insight deleted"); setConfirm(false); }, onError: (e) => toast.error(errorMessage(e)) })}
      />
    </article>
  );
}
