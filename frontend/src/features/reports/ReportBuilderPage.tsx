import { ArrowLeft, ChevronDown, FilePlus2, Save } from "lucide-react";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { Link, UNSAFE_DataRouterContext, useBlocker, useParams } from "react-router-dom";
import { useProject } from "@/api/hooks";
import { EmptyState, ErrorState, SkeletonRows, errorMessage } from "@/components/common/blocks";
import { Alert } from "@/components/ui/alert";
import { ConfirmDialog } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input, Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fmtDate, titleCase } from "@/lib/format";
import { useProjectId } from "@/lib/useProjectId";
import { cn } from "@/lib/utils";
import { AddSectionDialog } from "./AddSectionDialog";
import { PreviewTab } from "./PreviewTab";
import { SectionsEditor } from "./SectionsEditor";
import { Traceability } from "./Traceability";
import { useAnalysesForReport, useInsightsList, useMixedRuns, useReport, useSaveReport, useVersionIndex, useVisualizationsList, type Report, type ReportDraft, type ReportStatus } from "./reportsApi";
import { SECTION_KINDS, makeSection, type Lookups } from "./sections";

const toDraft = (r: Report): ReportDraft => ({ title: r.title, objective: r.objective, status: r.status, sections: r.sections });
const same = (a: ReportDraft, b: ReportDraft) => JSON.stringify(a) === JSON.stringify(b);

export function ReportBuilderPage() {
  const pid = useProjectId();
  const { reportId = "" } = useParams();
  const report = useReport(pid, reportId);
  const base = `/projects/${pid}`;
  return (
    <div>
      <Link to={`${base}/reports`} className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3.5" aria-hidden />All reports</Link>
      {report.isLoading ? (
        <div className="space-y-4" aria-busy aria-label="Loading report"><Skeleton className="h-10 w-2/3" /><Skeleton className="h-10 w-64" /><SkeletonRows n={4} /></div>
      ) : report.isError ? <ErrorState error={report.error} onRetry={() => report.refetch()} title="Couldn’t load this report" />
        : report.data && <Builder key={report.data.id} report={report.data} pid={pid} />}
    </div>
  );
}

function Builder({ report, pid }: { report: Report; pid: string }) {
  const project = useProject(pid);
  const canEdit = project.data?.role === "OWNER" || project.data?.role === "EDITOR";
  const save = useSaveReport(pid, report.id);
  const [draft, setDraft] = useState<ReportDraft>(() => toDraft(report));
  const [tab, setTab] = useState("build");
  const [adding, setAdding] = useState<string | null>(null);
  const dirty = canEdit && !same(draft, toDraft(report));
  const titleMissing = draft.title.trim().length === 0;

  const analyses = useAnalysesForReport(pid);
  const insights = useInsightsList(pid);
  const viz = useVisualizationsList(pid);
  const mixed = useMixedRuns(pid);
  const { versions } = useVersionIndex(pid);
  const lookups: Lookups = useMemo(() => ({ analyses: analyses.data ?? [], insights: insights.data ?? [], visualizations: viz.data ?? [], mixed: mixed.data ?? [], versions }), [analyses.data, insights.data, viz.data, mixed.data, versions]);

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const set = (p: Partial<ReportDraft>) => { save.reset(); setDraft((d) => ({ ...d, ...p })); };
  const doSave = () => save.mutate({ ...draft, title: draft.title.trim() }, { onSuccess: (r) => setDraft(toDraft(r)) });
  const router = useContext(UNSAFE_DataRouterContext);
  // pick up server-side changes (another editor, a refetch) unless the user has edits in flight
  const prev = useRef(report);
  useEffect(() => {
    if (prev.current === report) return;
    if (same(draft, toDraft(prev.current))) setDraft(toDraft(report));
    prev.current = report;
  }, [report, draft]);

  return (
    <div className="space-y-5">
      {router && <LeaveGuard when={dirty} />}
      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1 basis-80 space-y-1">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">Report</div>
            {canEdit ? (
              <>
                <label htmlFor="report-title" className="sr-only">Report title</label>
                <Input id="report-title" value={draft.title} onChange={(e) => set({ title: e.target.value })} maxLength={300} aria-invalid={titleMissing || undefined} className="h-auto border-transparent bg-transparent px-1 py-1 font-display text-[26px] font-semibold leading-tight shadow-none hover:border-input focus-visible:border-input" />
                {titleMissing && <p role="alert" className="text-xs text-destructive">A report needs a title.</p>}
              </>
            ) : <h1 className="font-display text-[28px] font-semibold leading-tight">{report.title}</h1>}
            <p className="text-xs text-muted-foreground">Created {fmtDate(report.created_at)}{report.updated_at && <> · last saved {fmtDate(report.updated_at, true)}</>}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <StatusToggle value={draft.status} onChange={(status) => set({ status })} readOnly={!canEdit} />
            {canEdit && (
              <Button onClick={doSave} disabled={!dirty || titleMissing} loading={save.isPending}><Save />Save changes</Button>
            )}
          </div>
        </div>
        <p className={cn("text-[13px]", dirty ? "font-medium text-warning" : "sr-only")} role="status" aria-live="polite">{dirty ? "You have unsaved changes." : save.isSuccess ? "All changes saved." : ""}</p>
        {save.isError && <Alert variant="error" title="Couldn’t save the report">{errorMessage(save.error)}</Alert>}
      </header>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label="Report views">
          <TabsTrigger value="build">Build</TabsTrigger>
          <TabsTrigger value="preview">Preview</TabsTrigger>
        </TabsList>
        <TabsContent value="build">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="min-w-0 space-y-6">
              <div className="space-y-1.5">
                <label htmlFor="report-objective" className="text-[13px] font-medium">Objective</label>
                {canEdit ? <Textarea id="report-objective" value={draft.objective} onChange={(e) => set({ objective: e.target.value })} rows={3} maxLength={4000} /> : <p className="text-sm">{report.objective || "No objective recorded."}</p>}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-semibold">Sections <span className="tabular text-sm font-normal text-muted-foreground">({draft.sections.length})</span></h2>
                {canEdit && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="secondary"><FilePlus2 />Add section<ChevronDown /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-72">
                      <DropdownMenuLabel>Add to this report</DropdownMenuLabel>
                      {SECTION_KINDS.filter((k) => k.addable).map((k) => (
                        <DropdownMenuItem key={k.type} onSelect={() => (k.needsRef ? setAdding(k.type) : set({ sections: [...draft.sections, makeSection(k.type, k.type === "text" ? "Untitled section" : k.label)] }))}>
                          <span className="flex flex-col"><span className="font-medium">{k.label}</span><span className="text-xs text-muted-foreground">{k.hint}</span></span>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
              {draft.sections.length === 0 ? (
                <EmptyState compact title="This report has no sections" description={canEdit ? "Add text, findings, analyses or charts. Methodology and limitations sections are composed by Lotus from what you include." : "Nothing has been added to this report yet."} />
              ) : (
                <SectionsEditor sections={draft.sections} onChange={(sections) => set({ sections })} lookups={lookups} readOnly={!canEdit} />
              )}
            </div>
            <aside className="min-w-0" aria-label="Report sources"><Traceability report={report} pid={pid} lookups={lookups} />{dirty && <p className="mt-2 text-xs text-muted-foreground">Sources update when you save.</p>}</aside>
          </div>
        </TabsContent>
        <TabsContent value="preview"><PreviewTab report={report} pid={pid} dirty={dirty} /></TabsContent>
      </Tabs>

      <AddSectionDialog pid={pid} type={adding} onClose={() => setAdding(null)} onAdd={(s) => { set({ sections: [...draft.sections, s] }); setAdding(null); }} />
    </div>
  );
}

function StatusToggle({ value, onChange, readOnly }: { value: ReportStatus; onChange: (s: ReportStatus) => void; readOnly: boolean }) {
  if (readOnly) return <Badge variant={value === "READY" ? "success" : "default"}>{titleCase(value.toLowerCase())}</Badge>;
  return (
    <div role="radiogroup" aria-label="Report status" className="inline-flex rounded-md border bg-card p-0.5">
      {(["DRAFT", "READY"] as const).map((s) => (
        <button key={s} type="button" role="radio" aria-checked={value === s} onClick={() => onChange(s)}
          className={cn("rounded px-3 py-1 text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring", value === s ? (s === "READY" ? "bg-success text-white" : "bg-muted text-foreground") : "text-muted-foreground hover:text-foreground")}>
          {titleCase(s.toLowerCase())}
        </button>
      ))}
    </div>
  );
}

/** Warns before in-app navigation discards edits (only when a data router is present). */
function LeaveGuard({ when }: { when: boolean }) {
  const blocker = useBlocker(when);
  return (
    <ConfirmDialog
      open={blocker.state === "blocked"} onOpenChange={(o) => { if (!o && blocker.state === "blocked") blocker.reset(); }}
      title="Leave without saving?" description="You have unsaved changes to this report. If you leave now they will be lost." confirmLabel="Leave and discard"
      onConfirm={() => blocker.state === "blocked" && blocker.proceed()}
    />
  );
}
