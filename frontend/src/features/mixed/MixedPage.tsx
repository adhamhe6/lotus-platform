import { BarChart3, Database, GitMerge, Plus, Trash2, Type } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useProject, qk } from "@/api/hooks";
import { ChartView } from "@/components/charts/ChartView";
import { EmptyState, ErrorState, PageHeader, Section, SkeletonRows, StatTile } from "@/components/common/blocks";
import { JobProgress } from "@/components/common/JobProgress";
import { Provenance } from "@/components/common/Provenance";
import { ConfirmDialog } from "@/components/ui/alert-dialog";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SimpleSelect } from "@/components/ui/select";
import { useActiveDataset } from "@/lib/activeDataset";
import { fmtDate, fmtNumber } from "@/lib/format";
import { useJobs } from "@/lib/jobs";
import { useProjectId } from "@/lib/useProjectId";
import { toast } from "sonner";
import { useMutation } from "@tanstack/react-query";
import { errorMessage } from "@/components/common/blocks";
import { ConfigForm } from "./ConfigForm";
import { FindingCard } from "./Findings";
import { JointDisplay } from "./JointDisplay";
import { SynthesisPanel } from "./SynthesisPanel";
import { meansChart, mixedKey, startMixed, useDeleteRun, useMixedRuns, useTextSources, type MixedBody, type MixedRunView } from "./api";

function RunResult({ run, pid, canWrite }: { run: MixedRunView; pid: string; canWrite: boolean }) {
  const r = run.result;
  const word = run.config.source === "codes" ? "code" : "theme";
  const chart = useMemo(() => meansChart(r, word), [r, word]);
  const t = r.thresholds;
  const o = r.overall;
  return (
    <div className="space-y-8">
      <Section title="Scope" description="Who is in this analysis and how many tests were run.">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label="Respondents with a written response" value={fmtNumber(o.respondents)} hint={`${fmtNumber(o.respondents_with_outcome)} have a value for ${o.outcome}`} petal />
          <StatTile label={`Mean ${o.outcome}`} value={fmtNumber(o.outcome_mean, 2)} hint={`Median ${fmtNumber(o.outcome_median, 2)}`} />
          <StatTile label="Tests run" value={fmtNumber(o.tests_run)} hint={`${fmtNumber(o.items)} ${word === "code" ? "codes" : "themes"} compared`} />
          <StatTile label="Multiple-test correction" value={<span className="text-[18px]">Holm</span>} hint={t.correction} />
        </div>
        <p className="flex items-center gap-2 text-xs text-muted-foreground"><Provenance kind="computed" label="Figures on this page are computed" />Respondents who wrote nothing are not counted as disagreeing: silence is not evidence.</p>
      </Section>

      {r.warnings.length > 0 && (
        <div className="space-y-2" aria-label="Warnings">{r.warnings.map((w) => <Alert key={w} variant="warning">{w}</Alert>)}</div>
      )}

      <Section title="Joint display" description={`Each ${word} beside the numbers, so you can read what people said and what was measured in one row. Open a row for quotes, convergence and group prevalence.`}>
        {r.items.length === 0 ? <EmptyState compact title="Nothing was compared" description="This run contained no themes or codes." /> : <JointDisplay result={r} />}
        {chart && <div className="rounded-xl border bg-card p-4"><ChartView spec={chart} height={Math.max(220, r.items.length * 2 * 30 + 60)} /></div>}
      </Section>

      <Section title="Findings" description="Only patterns that clear the evidence thresholds are reported. Each separates what the numbers show from what respondents said.">
        {r.findings.length === 0 ? (
          <EmptyState compact icon={<BarChart3 />} title="No findings met the evidence thresholds"
            description={<>Lotus deliberately reports nothing weaker. A finding needs a Holm-adjusted p below {fmtNumber(t.alpha)}, an effect of at least |g| {fmtNumber(t.min_abs_g_outcome)} on the outcome ({fmtNumber(t.min_abs_g_convergence)} for convergence), and at least {fmtNumber(t.min_group_n)} respondents with and without the item. The joint display above still shows every comparison, including the ones that fell short.</>} />
        ) : (
          <div className="space-y-3">{r.findings.map((f) => <FindingCard key={f.id} f={f} result={r} />)}</div>
        )}
      </Section>

      <SynthesisPanel run={run} canWrite={canWrite} pid={pid} />

      <div className="space-y-2">
        <details className="rounded-lg border bg-card px-4 py-3 text-sm">
          <summary className="cursor-pointer font-medium">Evidence thresholds</summary>
          <dl className="mt-2 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
            <div><dt className="text-xs text-muted-foreground">Significance level (Holm-adjusted)</dt><dd className="tabular font-medium">{fmtNumber(t.alpha)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Minimum |Hedges’ g|, outcome</dt><dd className="tabular font-medium">{fmtNumber(t.min_abs_g_outcome)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Minimum |Hedges’ g|, convergence</dt><dd className="tabular font-medium">{fmtNumber(t.min_abs_g_convergence)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Minimum respondents with and without</dt><dd className="tabular font-medium">{fmtNumber(t.min_group_n)}</dd></div>
            <div className="sm:col-span-2"><dt className="text-xs text-muted-foreground">Correction</dt><dd className="font-medium">{t.correction}</dd></div>
          </dl>
        </details>
        <details className="rounded-lg border bg-card px-4 py-3 text-sm">
          <summary className="cursor-pointer font-medium">Methodology</summary>
          <p className="mt-2 leading-relaxed text-muted-foreground">{r.methodology}</p>
        </details>
      </div>
    </div>
  );
}

export function MixedPage() {
  const pid = useProjectId();
  const project = useProject(pid);
  const canWrite = !!project.data && project.data.role !== "VIEWER";
  const { dataset, version, columns, loading } = useActiveDataset();
  const runs = useMixedRuns(pid);
  const sources = useTextSources(pid, version?.id);
  const { track } = useJobs();
  const [selected, setSelected] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [jobId, setJobId] = useState<string>();
  const [removing, setRemoving] = useState(false);
  const del = useDeleteRun(pid);
  const start = useMutation({
    mutationFn: (b: MixedBody) => startMixed(pid, b),
    onSuccess: (job) => {
      setJobId(job.id); setCreating(false);
      track(job, { title: "Mixed-methods analysis", invalidate: [mixedKey(pid), qk.insights(pid)], onSuccess: () => { setSelected(undefined); setJobId(undefined); }, onError: () => setJobId(undefined) });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const list = runs.data ?? [];
  const run = list.find((r) => r.id === selected) ?? list[0];
  useEffect(() => { if (!runs.isLoading && list.length === 0 && canWrite) setCreating(true); }, [runs.isLoading, list.length, canWrite]);

  const header = <PageHeader eyebrow="Mixed methods" title="What people say, beside what was measured"
    description="Compare each theme or code from open-ended responses with a numeric outcome. Where the comments and the numbers point the same way, you see it; where they do not, you see that too."
    actions={canWrite && !creating ? <Button onClick={() => setCreating(true)}><Plus />New analysis</Button> : undefined} />;

  if (loading || project.isLoading || runs.isLoading) return <>{header}<SkeletonRows n={5} /></>;
  if (runs.isError) return <>{header}<ErrorState title="Couldn’t load mixed-methods runs" error={runs.error} onRetry={() => runs.refetch()} /></>;
  if (!dataset || !version) {
    return <>{header}{list.length === 0 && <EmptyState icon={<Database />} title="No dataset yet" description="Mixed-methods analysis needs a dataset with a text column and a numeric outcome." action={<Button asChild><Link to={`/projects/${pid}/data`}>Go to Data</Link></Button>} />}</>;
  }
  const textSources = sources.data ?? [];

  return (
    <div className="space-y-6">
      {header}
      {!canWrite && <Alert variant="info">You have view-only access. You can read runs and evidence; running or deleting analyses and generating interpretations are available to editors.</Alert>}
      {jobId && <div className="rounded-lg border bg-card px-4 py-3"><div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Mixed-methods analysis</div><JobProgress jobId={jobId} /></div>}

      {creating && canWrite && (
        <section className="rounded-xl border bg-card p-5" aria-labelledby="mx-new">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div><h2 id="mx-new" className="font-display text-lg font-semibold">New mixed-methods analysis</h2><p className="text-[13px] text-muted-foreground">Dataset version: {dataset.name}</p></div>
            {list.length > 0 && <Button variant="ghost" size="sm" onClick={() => setCreating(false)}>Cancel</Button>}
          </div>
          {sources.isLoading || columns.length === 0 ? <SkeletonRows n={3} /> : sources.isError ? <ErrorState title="Couldn’t load text columns" error={sources.error} onRetry={() => sources.refetch()} /> : textSources.length === 0 ? (
            <EmptyState compact icon={<Type />} title="No text column in this dataset version" description="Mixed-methods analysis integrates open-ended responses with numbers, so it needs a free-text column. Check column types on the Data page." action={<Button asChild variant="secondary"><Link to={`/projects/${pid}/data`}>Review columns</Link></Button>} />
          ) : (
            <ConfigForm pid={pid} versionId={version.id} columns={columns} sources={textSources} busy={start.isPending} onSubmit={(b) => start.mutate(b)} />
          )}
        </section>
      )}

      {list.length === 0 ? (
        !creating && <EmptyState icon={<GitMerge />} title="No mixed-methods analyses yet" description="Pick a text column and a numeric outcome to see whether what people wrote lines up with what was measured." action={canWrite ? <Button onClick={() => setCreating(true)}><Plus />New analysis</Button> : undefined} />
      ) : run && (
        <>
          <div className="flex flex-wrap items-end gap-3 border-b pb-4">
            <div className="w-full sm:w-[420px]">
              <label htmlFor="mx-run-select" className="mb-1.5 block text-[13px] font-medium">Analysis run</label>
              <SimpleSelect id="mx-run-select" value={run.id} onValueChange={setSelected}
                options={list.map((r, i) => ({ value: r.id, label: `${r.outcome_column} by ${r.config.source === "codes" ? "codes" : "themes"} · ${r.column_name}${r.group_column ? ` · by ${r.group_column}` : ""}`, hint: `${i === 0 ? "latest · " : ""}${fmtDate(r.created_at, true)}` }))} />
            </div>
            <div className="text-xs text-muted-foreground">{fmtNumber(list.length)} run{list.length === 1 ? "" : "s"} in this project</div>
            {canWrite && <Button className="ml-auto" variant="secondary" size="sm" onClick={() => setRemoving(true)}><Trash2 />Delete run</Button>}
          </div>
          <RunResult key={run.id} run={run} pid={pid} canWrite={canWrite} />
        </>
      )}
      <ConfirmDialog open={removing} onOpenChange={setRemoving} title="Delete this analysis run?" description="The run, its interpretation and the insights created from it are removed. Your themes, codes and data are not affected."
        confirmLabel="Delete run" loading={del.isPending} onConfirm={() => run && del.mutate(run.id, { onSuccess: () => { setRemoving(false); setSelected(undefined); toast.success("Run deleted"); }, onError: (e) => toast.error(errorMessage(e)) })} />
    </div>
  );
}
