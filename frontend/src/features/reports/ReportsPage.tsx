import { FilePlus2, FileText, Sparkles, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError } from "@/api/client";
import { useProject } from "@/api/hooks";
import type { Job } from "@/api/types";
import { EmptyState, ErrorState, PageHeader, SkeletonRows, errorMessage } from "@/components/common/blocks";
import { JobProgress } from "@/components/common/JobProgress";
import { Alert } from "@/components/ui/alert";
import { ConfirmDialog } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { SimpleSelect } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { fmtDate, fmtNumber, titleCase } from "@/lib/format";
import { useJobs } from "@/lib/jobs";
import { useProjectId } from "@/lib/useProjectId";
import { qk } from "@/api/hooks";
import { generateReport, useCreateReport, useDeleteReport, useReports, useVersionIndex, type Report, type SourceKey } from "./reportsApi";

const SOURCE_LABEL: [SourceKey, string, string][] = [
  ["analysis_runs", "analysis", "analyses"], ["insights", "insight", "insights"], ["theme_runs", "theme run", "theme runs"],
  ["mixed_runs", "mixed-methods run", "mixed-methods runs"], ["visualizations", "chart", "charts"],
];
const sourceSummary = (r: Report) => SOURCE_LABEL.map(([k, one, many]) => { const n = r.sources?.[k]?.length ?? 0; return n ? `${fmtNumber(n)} ${n === 1 ? one : many}` : null; }).filter(Boolean).join(" · ");

export function ReportsPage() {
  const pid = useProjectId();
  const nav = useNavigate();
  const project = useProject(pid);
  const canEdit = project.data?.role === "OWNER" || project.data?.role === "EDITOR";
  const reports = useReports(pid);
  const del = useDeleteReport(pid);
  const [generate, setGenerate] = useState(false);
  const [blank, setBlank] = useState(false);
  const [toDelete, setToDelete] = useState<Report | null>(null);
  const [genError, setGenError] = useState<{ code: string; message: string } | null>(null);
  const base = `/projects/${pid}`;

  return (
    <div>
      <PageHeader
        title="Reports"
        description="Assemble analyses, insights and themes into a report where every statement traces back to its source."
        actions={canEdit && (
          <>
            <Button variant="secondary" onClick={() => setBlank(true)}><FilePlus2 />New blank report</Button>
            <Button onClick={() => { setGenError(null); setGenerate(true); }}><Sparkles />Generate draft</Button>
          </>
        )}
      />
      {genError && (
        <Alert variant={genError.code === "NOTHING_TO_REPORT" ? "info" : "error"} className="mb-4" title={genError.code === "NOTHING_TO_REPORT" ? "Nothing to report on yet" : "The draft couldn’t be generated"}
          action={genError.code === "NOTHING_TO_REPORT" ? <Button asChild size="sm" variant="secondary"><Link to={`${base}/analysis/new`}>Run an analysis</Link></Button> : undefined}>
          {genError.code === "NOTHING_TO_REPORT" ? "A draft is built from completed analyses, detected themes or saved visualizations, and this project has none yet. Run an analysis first, then generate the draft." : genError.message}
        </Alert>
      )}
      {reports.isLoading ? <SkeletonRows n={4} />
        : reports.isError ? <ErrorState error={reports.error} onRetry={() => reports.refetch()} title="Couldn’t load reports" />
          : (reports.data ?? []).length === 0 ? (
            <EmptyState
              icon={<FileText />} title="No reports yet"
              description={canEdit ? "Generate a first draft from the analyses you’ve already run, or start with a blank report and add sections yourself." : "No reports have been created in this project."}
              action={canEdit ? <div className="flex flex-wrap justify-center gap-2"><Button onClick={() => setGenerate(true)}><Sparkles />Generate draft</Button><Button variant="secondary" onClick={() => setBlank(true)}>New blank report</Button></div> : undefined}
            />
          ) : (
            <ul className="space-y-3">
              {reports.data!.map((r) => (
                <li key={r.id}>
                  <Card className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 p-4">
                    <div className="min-w-0 flex-1 basis-64 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="min-w-0 text-[16px] font-semibold leading-snug"><Link to={`${base}/reports/${r.id}`} className="hover:underline focus-visible:outline-2 focus-visible:outline-ring">{r.title}</Link></h2>
                        <Badge variant={r.status === "READY" ? "success" : "default"}>{titleCase(r.status.toLowerCase())}</Badge>
                      </div>
                      <p className="text-[13px] text-muted-foreground">{fmtNumber(r.sections.length)} {r.sections.length === 1 ? "section" : "sections"}{sourceSummary(r) && <> · {sourceSummary(r)}</>}</p>
                      <p className="text-xs text-muted-foreground">Created {fmtDate(r.created_at)}{r.updated_at && <> · updated {fmtDate(r.updated_at, true)}</>}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button asChild variant="secondary" size="sm"><Link to={`${base}/reports/${r.id}`} aria-label={`Open ${r.title}`}>Open</Link></Button>
                      {canEdit && <Button variant="ghost" size="icon-sm" aria-label={`Delete ${r.title}`} onClick={() => setToDelete(r)}><Trash2 /></Button>}
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          )}

      <GenerateDialog
        open={generate} onOpenChange={setGenerate} pid={pid}
        onDone={(reportId) => { setGenerate(false); if (reportId) nav(`${base}/reports/${reportId}`); }}
        onFailed={(code, message) => { setGenerate(false); setGenError({ code, message }); }}
      />
      <BlankDialog open={blank} onOpenChange={setBlank} pid={pid} onCreated={(id) => nav(`${base}/reports/${id}`)} />
      <ConfirmDialog
        open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)} title="Delete this report?" loading={del.isPending}
        description={toDelete ? `“${toDelete.title}” will be permanently deleted. The analyses and insights it draws on are not affected.` : ""}
        onConfirm={() => toDelete && del.mutate(toDelete.id, { onSuccess: () => setToDelete(null), onError: () => setToDelete(null) })}
      />
      {del.isError && <Alert variant="error" className="mt-4" title="Couldn’t delete the report">{errorMessage(del.error)}</Alert>}
    </div>
  );
}

const ALL = "__all__";
function GenerateDialog({ open, onOpenChange, pid, onDone, onFailed }: { open: boolean; onOpenChange: (o: boolean) => void; pid: string; onDone: (reportId?: string) => void; onFailed: (code: string, message: string) => void }) {
  const { track } = useJobs();
  const { versions } = useVersionIndex(pid);
  const [title, setTitle] = useState("");
  const [version, setVersion] = useState(ALL);
  const [withAi, setWithAi] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const busy = submitting || !!jobId;

  const submit = async () => {
    setSubmitting(true); setError(null);
    try {
      const job: Job = await generateReport(pid, { title: title.trim(), dataset_version_id: version === ALL ? undefined : version, with_ai: withAi });
      setJobId(job.id);
      track(job, {
        title: "Report draft", invalidate: [qk.reports(pid)],
        onSuccess: (j) => { setJobId(null); onDone((j.result_ref as { report_id?: string } | null)?.report_id); },
        onError: (j) => { setJobId(null); onFailed(String(j.error?.code ?? "JOB_FAILED"), String(j.error?.message ?? "The job failed.")); },
      });
    } catch (e) {
      if (e instanceof ApiError && e.code === "NOTHING_TO_REPORT") { onFailed(e.code, e.message); } else setError(e);
    } finally { setSubmitting(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Generate a draft report</DialogTitle>
          <DialogDescription>Lotus assembles a draft from this project’s completed analyses, key insights, themes and saved charts. You can edit everything afterwards.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <Field label="Title (optional)" htmlFor="gen-title" hint="Leave blank to use the project name.">
            <Input id="gen-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} disabled={busy} />
          </Field>
          <Field label="Dataset version (optional)" htmlFor="gen-version" hint="Limit the draft to analyses run on one version of a dataset.">
            <SimpleSelect id="gen-version" value={version} onValueChange={setVersion} disabled={busy} options={[{ value: ALL, label: "All versions" }, ...versions.map((v) => ({ value: v.id, label: `${v.datasetName} · v${v.number}`, hint: v.label }))]} />
          </Field>
          <div className="flex items-start gap-3 rounded-lg border bg-muted/40 p-3">
            <Switch id="gen-ai" checked={withAi} onCheckedChange={setWithAi} disabled={busy} className="mt-0.5" />
            <div className="space-y-0.5">
              <label htmlFor="gen-ai" className="text-sm font-medium">Include AI-assisted summary</label>
              <p className="text-xs text-muted-foreground">A language model drafts a short summary from the computed results. It is included only if every number in its text passes validation against those results; otherwise the draft is built without it.</p>
            </div>
          </div>
          {error != null && <Alert variant="error" title="Couldn’t start the draft">{errorMessage(error)}</Alert>}
          {jobId && <JobProgress jobId={jobId} />}
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" loading={busy}><Sparkles />Generate draft</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function BlankDialog({ open, onOpenChange, pid, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; pid: string; onCreated: (id: string) => void }) {
  const create = useCreateReport(pid);
  const [title, setTitle] = useState("");
  const ok = title.trim().length > 0;
  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) create.reset(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New blank report</DialogTitle>
          <DialogDescription>Start with an empty report and add text, analyses, charts and findings yourself.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (ok) create.mutate({ title: title.trim() }, { onSuccess: (r) => { onOpenChange(false); setTitle(""); onCreated(r.id); } }); }}>
          <Field label="Title" htmlFor="blank-title"><Input id="blank-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} autoFocus /></Field>
          {create.isError && <Alert variant="error">{errorMessage(create.error)}</Alert>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={!ok} loading={create.isPending}>Create report</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
