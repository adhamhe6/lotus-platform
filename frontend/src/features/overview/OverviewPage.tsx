import { ArrowRight, BarChart3, FileText, Layers, LineChart, MessagesSquare, Pencil, Search, Sparkles, Upload } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useProject, useUpdateProject } from "@/api/hooks";
import type { Role } from "@/api/types";
import { ChartView } from "@/components/charts/ChartView";
import { EmptyState, ErrorState, Section, SkeletonCards, StatTile, errorMessage } from "@/components/common/blocks";
import { Provenance } from "@/components/common/Provenance";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { fmtDate, fmtNumber, fmtP, fmtPct, fmtRelative, titleCase } from "@/lib/format";
import { useProjectId } from "@/lib/useProjectId";
import { ShareDialog } from "./ShareDialog";
import { useOverview, type OvDataset, type OvEvidence, type Overview } from "./overviewApi";

const ROLE_LABEL: Record<Role, string> = { OWNER: "Owner", EDITOR: "Editor", VIEWER: "Viewer" };
const statusVariant = (s: string) => (s === "READY" || s === "COMPLETED" ? "success" : s === "FAILED" || s === "CANCELLED" ? "destructive" : "warning") as "success" | "destructive" | "warning";
const evidenceValue = (e: OvEvidence) => (/(^|\s)p(-value)?$|^p\b/i.test(e.label) ? fmtP(e.value) : `${fmtNumber(e.value)}${e.unit ? ` ${e.unit}` : ""}`);

export function OverviewPage() {
  const pid = useProjectId();
  const project = useProject(pid);
  const ov = useOverview(pid);
  const role = project.data?.role ?? ov.data?.role;
  const canEdit = role === "OWNER" || role === "EDITOR";
  const base = `/projects/${pid}`;
  const name = project.data?.name ?? ov.data?.project.name;
  const objective = project.data?.objective ?? ov.data?.project.objective ?? "";

  return (
    <div className="space-y-8">
      <Header pid={pid} name={name} objective={objective} role={role} canEdit={canEdit} loading={project.isLoading && !ov.data} />
      {ov.isLoading ? <OverviewSkeleton />
        : ov.isError ? <ErrorState error={ov.error} onRetry={() => ov.refetch()} title="Couldn’t load the project overview" />
          : ov.data && (ov.data.datasets.length === 0 ? <GetStarted base={base} canEdit={canEdit} /> : <Workspace data={ov.data} base={base} canAsk={canEdit} />)}
    </div>
  );
}

function Header({ pid, name, objective, role, canEdit, loading }: { pid: string; name?: string; objective: string; role?: Role; canEdit: boolean; loading: boolean }) {
  return (
    <header className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-primary">Project overview{role && <Badge variant="primary" className="normal-case tracking-normal">{ROLE_LABEL[role]}</Badge>}</div>
          {loading ? <Skeleton className="h-9 w-72" /> : <h1 className="font-display text-[28px] font-semibold leading-tight">{name}</h1>}
        </div>
        <ShareDialog projectId={pid} role={role} />
      </div>
      <Objective pid={pid} value={objective} canEdit={canEdit} />
    </header>
  );
}

function Objective({ pid, value, canEdit }: { pid: string; value: string; canEdit: boolean }) {
  const update = useUpdateProject(pid);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const start = () => { setDraft(value); setEditing(true); update.reset(); };
  const save = () => update.mutate({ objective: draft.trim() }, { onSuccess: () => setEditing(false) });

  if (editing) {
    return (
      <form className="papyrus max-w-3xl space-y-2 rounded-lg border bg-card p-4" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <label htmlFor="objective" className="text-[13px] font-medium">Research objective</label>
        <Textarea id="objective" value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={4000} rows={3} autoFocus />
        {update.isError && <p role="alert" className="text-xs text-destructive">{errorMessage(update.error)}</p>}
        <div className="flex gap-2">
          <Button type="submit" size="sm" loading={update.isPending}>Save</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
        </div>
      </form>
    );
  }
  return (
    <div className="max-w-3xl">
      <h2 className="text-[13px] font-medium text-muted-foreground">Research objective</h2>
      <div className="mt-1 flex items-start gap-2">
        <p className={value ? "text-[15px] leading-relaxed" : "text-sm text-muted-foreground"}>{value || (canEdit ? "No objective yet. State what this project should find out; it shapes suggestions and reports." : "No research objective has been set.")}</p>
        {canEdit && <Button variant="ghost" size="icon-sm" aria-label="Edit objective" onClick={start}><Pencil /></Button>}
      </div>
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <div className="space-y-6" aria-busy aria-label="Loading overview">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
      <SkeletonCards n={3} />
    </div>
  );
}

function GetStarted({ base, canEdit }: { base: string; canEdit: boolean }) {
  const steps = [
    { n: 1, icon: <Upload />, title: "Upload data", text: canEdit ? "Add a CSV or Excel file. Lotus profiles it and flags quality issues before you analyse anything." : "A project editor needs to upload a dataset before analysis can begin.", to: `${base}/data`, cta: "Go to data" },
    { n: 2, icon: <BarChart3 />, title: "Explore and analyse", text: "Run statistical analyses and detect themes in open-ended answers. Every result keeps its method and sample size.", to: `${base}/analysis`, cta: "Open analyses" },
    { n: 3, icon: <Sparkles />, title: "Ask Lotus or write the report", text: "Ask questions about your data in plain language, then assemble findings into a traceable report.", to: `${base}/assistant`, cta: "Ask Lotus", second: { to: `${base}/reports`, cta: "Reports" } },
  ];
  return (
    <section aria-labelledby="get-started" className="petal papyrus border bg-card p-6 md:p-8">
      <h2 id="get-started" className="font-display text-2xl font-semibold">Get started</h2>
      <p className="mt-1 max-w-xl text-sm text-muted-foreground">This project has no data yet. Three steps take you from a file to evidence you can cite.</p>
      <ol className="mt-6 grid gap-4 md:grid-cols-3">
        {steps.map((s) => (
          <li key={s.n} className="flex flex-col rounded-lg border bg-background/60 p-4">
            <div className="flex items-center gap-3">
              <span className="flex size-9 items-center justify-center rounded-full bg-accent text-accent-foreground [&_svg]:size-4" aria-hidden>{s.icon}</span>
              <h3 className="font-semibold"><span className="sr-only">Step {s.n}: </span>{s.title}</h3>
            </div>
            <p className="mt-3 flex-1 text-sm text-muted-foreground">{s.text}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button asChild size="sm" variant={s.n === 1 ? "default" : "secondary"}><Link to={s.to}>{s.cta}<ArrowRight /></Link></Button>
              {s.second && <Button asChild size="sm" variant="ghost"><Link to={s.second.to}>{s.second.cta}</Link></Button>}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Workspace({ data, base, canAsk }: { data: Overview; base: string; canAsk: boolean }) {
  const c = data.counts;
  const tiles: { label: string; value: number; to: string }[] = [
    { label: "Datasets", value: c.datasets, to: `${base}/data` },
    { label: "Analyses", value: c.analyses, to: `${base}/analysis` },
    { label: "Insights", value: c.insights, to: `${base}/insights` },
    { label: "Themes", value: c.themes, to: `${base}/qualitative` },
    { label: "Reports", value: c.reports, to: `${base}/reports` },
  ];
  return (
    <div className="space-y-8">
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" aria-label="Project totals">
        {tiles.map((t, i) => (
          <li key={t.label}><Link to={t.to} className="block rounded-lg focus-visible:outline-2 focus-visible:outline-ring"><StatTile label={t.label} value={fmtNumber(t.value)} petal={i === 0} /></Link></li>
        ))}
      </ul>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-8">
          <KeyInsights items={data.key_insights} base={base} />
          <RecentAnalyses items={data.recent_analyses} base={base} />
          <Visualizations items={data.visualizations} base={base} />
          <DatasetHealth items={data.datasets} base={base} />
        </div>
        <aside className="min-w-0 space-y-8" aria-label="Project context">
          {canAsk && <AskLotus base={base} />}
          <Themes items={data.themes} base={base} />
          <ReportsList items={data.reports} base={base} />
          <Jobs items={data.jobs} />
          <Activity items={data.activity} base={base} />
        </aside>
      </div>
    </div>
  );
}

const Muted = ({ children }: { children: ReactNode }) => <p className="text-sm text-muted-foreground">{children}</p>;
const MoreLink = ({ to, children }: { to: string; children: ReactNode }) => <Link to={to} className="text-[13px] font-medium text-primary hover:underline">{children}</Link>;

function AskLotus({ base }: { base: string }) {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  return (
    <form
      className="petal papyrus space-y-2 border bg-card p-4"
      onSubmit={(e) => { e.preventDefault(); const t = q.trim(); if (t.length >= 2) nav(`${base}/assistant?q=${encodeURIComponent(t)}`); }}
    >
      <label htmlFor="ask-lotus" className="flex items-center gap-2 font-display text-lg font-semibold"><MessagesSquare className="size-4 text-primary" aria-hidden />Ask Lotus</label>
      <p className="text-xs text-muted-foreground">Answers are computed from your data first, then explained.</p>
      <div className="flex gap-2">
        <Input id="ask-lotus" value={q} onChange={(e) => setQ(e.target.value)} placeholder="What drives satisfaction?" maxLength={2000} />
        <Button type="submit" size="icon" aria-label="Ask" disabled={q.trim().length < 2}><Search /></Button>
      </div>
    </form>
  );
}

function KeyInsights({ items, base }: { items: Overview["key_insights"]; base: string }) {
  return (
    <Section title="Key insights" description="Findings derived from completed analyses, strongest first." actions={<MoreLink to={`${base}/insights`}>All insights</MoreLink>}>
      {items.length === 0 ? (
        <EmptyState compact icon={<Sparkles />} title="No insights yet" description="Insights appear once analyses have produced results that clear the evidence thresholds." action={<Button asChild variant="secondary"><Link to={`${base}/insights`}>Go to insights</Link></Button>} />
      ) : (
        <ul className="space-y-3">
          {items.map((i) => (
            <li key={i.id}>
              <Card className="space-y-2.5 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Provenance kind="computed" />
                  <Badge variant={i.qualification === "strong" ? "success" : i.qualification === "moderate" ? "primary" : "warning"}>{titleCase(i.qualification)} evidence</Badge>
                  {i.pinned && <Badge variant="outline">Pinned</Badge>}
                </div>
                <h3 className="text-[15px] font-semibold leading-snug">{i.title}</h3>
                <p className="text-sm text-foreground/85">{i.statement}</p>
                {i.evidence.length > 0 && (
                  <dl className="flex flex-wrap gap-x-5 gap-y-1 rounded-md bg-muted/60 px-3 py-2 text-xs">
                    {i.evidence.map((e, k) => (
                      <div key={k} className="flex items-baseline gap-1.5"><dt className="text-muted-foreground">{e.label}</dt><dd className="tabular font-semibold">{evidenceValue(e)}</dd></div>
                    ))}
                  </dl>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function RecentAnalyses({ items, base }: { items: Overview["recent_analyses"]; base: string }) {
  return (
    <Section title="Recent analyses" actions={<MoreLink to={`${base}/analysis`}>All analyses</MoreLink>}>
      {items.length === 0 ? (
        <EmptyState compact icon={<LineChart />} title="No analyses yet" description="Run a first analysis to see headline results here." action={<Button asChild><Link to={`${base}/analysis/new`}>Run an analysis</Link></Button>} />
      ) : (
        <Card>
          <ul className="divide-y">
            {items.map((a) => (
              <li key={a.id}>
                <Link to={`${base}/analysis/${a.id}`} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{a.title}</p>
                    <p className="text-xs text-muted-foreground">{titleCase(a.analysis_type)} · {fmtRelative(a.created_at)}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    {a.headline && <span className="text-xs text-muted-foreground">{a.headline.label} <span className="tabular font-semibold text-foreground">{fmtNumber(a.headline.value)}</span></span>}
                    <Badge variant={statusVariant(a.status)}>{titleCase(a.status.toLowerCase())}</Badge>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </Section>
  );
}

function Visualizations({ items, base }: { items: Overview["visualizations"]; base: string }) {
  return (
    <Section title="Saved visualizations" actions={<MoreLink to={`${base}/visualizations`}>All visualizations</MoreLink>}>
      {items.length === 0 ? (
        <EmptyState compact icon={<BarChart3 />} title="No saved visualizations" description="Charts you save from the visualization studio show up here." action={<Button asChild variant="secondary"><Link to={`${base}/visualizations`}>Create a chart</Link></Button>} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {items.map((v) => <Card key={v.id} className="p-4"><ChartView spec={v.spec} height={220} /></Card>)}
        </div>
      )}
    </Section>
  );
}

function DatasetHealth({ items, base }: { items: OvDataset[]; base: string }) {
  return (
    <Section title="Dataset health" description="Quality checks on the latest version of each dataset." actions={<MoreLink to={`${base}/data`}>All datasets</MoreLink>}>
      <div className="grid gap-3 sm:grid-cols-2">
        {items.map((d) => (
          <Link key={d.id} to={`${base}/data/${d.id}`} className="block rounded-lg focus-visible:outline-2 focus-visible:outline-ring">
            <Card className="h-full space-y-3 p-4 transition-colors hover:border-primary/40">
              <div className="flex items-start justify-between gap-2">
                <h3 className="min-w-0 text-[15px] font-semibold leading-snug">{d.name}</h3>
                <Badge variant={statusVariant(d.status)}>{titleCase(d.status.toLowerCase())}</Badge>
              </div>
              {d.rows !== null ? (
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                  <Fact label="Size" value={`${fmtNumber(d.rows)} rows × ${fmtNumber(d.columns)} columns`} wide />
                  <Fact label="Missing values" value={fmtPct(d.missing_pct)} />
                  <Fact label="Duplicate rows" value={fmtNumber(d.duplicate_rows)} />
                  <Fact label="Warnings" value={fmtNumber(d.warnings)} tone={d.warnings > 0 ? "warn" : undefined} />
                  <Fact label="Versions" value={fmtNumber(d.version_count)} />
                </dl>
              ) : <p className="text-xs text-muted-foreground">{d.status === "FAILED" ? "This dataset could not be processed." : "Profiling is in progress."}</p>}
            </Card>
          </Link>
        ))}
      </div>
    </Section>
  );
}

const Fact = ({ label, value, wide, tone }: { label: string; value: string; wide?: boolean; tone?: "warn" }) => (
  <div className={wide ? "col-span-2" : undefined}><dt className="text-muted-foreground">{label}</dt><dd className={`tabular font-semibold ${tone === "warn" ? "text-warning" : ""}`}>{value}</dd></div>
);

function Themes({ items, base }: { items: Overview["themes"]; base: string }) {
  return (
    <Section title="Themes" actions={<MoreLink to={`${base}/qualitative`}>Explore</MoreLink>}>
      {items.length === 0 ? (
        <EmptyState compact icon={<MessagesSquare />} title="No themes yet" description="Detect themes in an open-ended text column." action={<Button asChild variant="secondary" size="sm"><Link to={`${base}/qualitative`}>Detect themes</Link></Button>} />
      ) : (
        <Card className="space-y-3 p-4">
          <div className="flex"><Provenance kind="qualitative" /></div>
          <ul className="space-y-3">
            {items.map((t) => (
              <li key={t.id} className="space-y-1">
                <div className="flex items-baseline justify-between gap-2 text-[13px]"><span className="min-w-0 truncate font-medium">{t.name}</span><span className="tabular shrink-0 text-muted-foreground">{fmtPct(t.share_pct)} · {fmtNumber(t.response_count)}</span></div>
                <Progress value={Math.min(1, t.share_pct / 100)} label={`${t.name}: ${fmtPct(t.share_pct)} of responses`} />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </Section>
  );
}

function ReportsList({ items, base }: { items: Overview["reports"]; base: string }) {
  return (
    <Section title="Reports" actions={<MoreLink to={`${base}/reports`}>All reports</MoreLink>}>
      {items.length === 0 ? (
        <EmptyState compact icon={<FileText />} title="No reports yet" description="Draft a report from your analyses and insights." action={<Button asChild variant="secondary" size="sm"><Link to={`${base}/reports`}>Generate a draft</Link></Button>} />
      ) : (
        <Card><ul className="divide-y">{items.map((r) => (
          <li key={r.id}><Link to={`${base}/reports/${r.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring"><span className="min-w-0 truncate text-sm font-medium">{r.title}</span><Badge variant={r.status === "READY" ? "success" : "default"}>{titleCase(r.status.toLowerCase())}</Badge></Link></li>
        ))}</ul></Card>
      )}
    </Section>
  );
}

function Jobs({ items }: { items: Overview["jobs"] }) {
  return (
    <Section title="Background jobs">
      {items.length === 0 ? <Muted>No background jobs have run in this project.</Muted> : (
        <Card><ul className="divide-y">{items.map((j) => {
          const running = j.status === "PENDING" || j.status === "RUNNING";
          return (
            <li key={j.id} className="space-y-1.5 px-4 py-2.5">
              <div className="flex items-center justify-between gap-2"><span className="truncate text-sm">{titleCase(j.type)}</span><Badge variant={statusVariant(j.status)}>{titleCase(j.status.toLowerCase())}</Badge></div>
              {running ? <><Progress value={j.progress} label={j.stage ?? "Job progress"} /><p className="text-xs text-muted-foreground" role="status">{j.stage ?? "Queued…"}</p></> : <p className="text-xs text-muted-foreground">{fmtRelative(j.created_at)}</p>}
            </li>
          );
        })}</ul></Card>
      )}
    </Section>
  );
}

const ACTIVITY_LINK: Record<string, (b: string, id: string) => string> = {
  analysis: (b, id) => `${b}/analysis/${id}`, insight: (b) => `${b}/insights`, dataset: (b, id) => `${b}/data/${id}`, report: (b, id) => `${b}/reports/${id}`,
};
function Activity({ items, base }: { items: Overview["activity"]; base: string }) {
  return (
    <Section title="Activity">
      {items.length === 0 ? <Muted>Nothing has happened in this project yet.</Muted> : (
        <ol className="space-y-3 border-l pl-4">
          {items.map((a) => (
            <li key={`${a.kind}-${a.id}`} className="relative text-sm">
              <span className="absolute -left-[21px] top-1.5 size-2 rounded-full bg-primary/60" aria-hidden />
              <p className="text-xs text-muted-foreground"><Layers className="mr-1 inline size-3" aria-hidden />{titleCase(a.kind)} · <time dateTime={a.at} title={fmtDate(a.at, true)}>{fmtRelative(a.at)}</time></p>
              <Link to={(ACTIVITY_LINK[a.kind] ?? (() => base))(base, a.id)} className="font-medium hover:underline">{a.title}</Link>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}

