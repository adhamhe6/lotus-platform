import { ArrowLeft, ArrowRight, Database, Play } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { qk, TERMINAL, useAnalysisTypes, useJobQuery, useProfile, useProject } from "@/api/hooks";
import { ApiError } from "@/api/client";
import type { AnalysisType, Column } from "@/api/types";
import { EmptyState, ErrorState, errorMessage, PageHeader, SkeletonCards } from "@/components/common/blocks";
import { JobProgressView } from "@/components/common/JobProgress";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { SimpleSelect } from "@/components/ui/select";
import { useActiveDataset } from "@/lib/activeDataset";
import { useJobs } from "@/lib/jobs";
import { fmtNumber, fmtPct, titleCase } from "@/lib/format";
import { useProjectId } from "@/lib/useProjectId";
import { cn } from "@/lib/utils";
import { useRunAnalysis } from "./api";
import { buildConfig, defaultParams, emptyDraft, parsePreset, paramsValid, STEP, STEP_LABELS, stepForError, unavailableReason, varsValid, type Draft } from "./builderModel";
import { ParameterStep } from "./components/ParameterStep";
import { Stepper } from "./components/Stepper";
import { VariableStep } from "./components/VariableStep";

const STEP_INTRO = [
  { title: "Choose the data", text: "Pick the dataset and the exact version to analyse. Results are tied to that version, so they stay reproducible." },
  { title: "Choose an analysis", text: "Pick the question you want answered. Only analyses that your dataset can support are available." },
  { title: "Choose the variables", text: "Assign columns to each role. Columns that can’t play a role are shown but disabled, with the reason." },
  { title: "Configure", text: "Settings specific to this analysis. Defaults are sensible; change them only if you have a reason." },
  { title: "Review and run", text: "Check what will be computed, then run it. Results open in the result workspace." },
] as const;

export function AnalysisBuilderPage() {
  const pid = useProjectId();
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const { data: project } = useProject(pid);
  const canRun = project?.role === "OWNER" || project?.role === "EDITOR";
  const active = useActiveDataset();
  const { dataset, version, columns } = active;
  const profile = useProfile(dataset?.id, version?.id);
  const types = useAnalysisTypes();
  const { track } = useJobs();
  const run = useRunAnalysis(pid);

  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [step, setStep] = useState<number>(STEP.Dataset);
  const [serverError, setServerError] = useState<{ message: string; step: number } | null>(null);
    const [running, setRunning] = useState<{ analysisId: string; jobId: string } | null>(null);

  const type = types.data?.find((t) => t.type === draft.type);
  const colsLoaded = !!profile.data;

  // Deep-link preset: type, variables and settings are applied once the catalogue is known.
  const presetApplied = useRef(false);
  useEffect(() => {
    if (presetApplied.current || !types.data) return;
    presetApplied.current = true;
    const preset = parsePreset(sp, types.data);
    if (!preset.type) return;
    setDraft(preset.draft);
    setStep(preset.hasVars ? STEP.Run : STEP.Variables);
  }, [types.data, sp]);

  // …and the dataset version (it may belong to another dataset than the active one).
  const versionApplied = useRef(false);
  useEffect(() => {
    const want = sp.get("version");
    if (versionApplied.current || !want) return;
    if (active.versions.some((v) => v.id === want)) { active.setVersion(want); versionApplied.current = true; return; }
    const owner = active.datasets.find((d) => d.latest_version?.id === want);
    if (owner) { active.setDataset(owner.id); active.setVersion(want); versionApplied.current = true; }
    else if (!active.loading && active.versions.length) versionApplied.current = true;
  }, [sp, active]);

  const varsOk = !!type && varsValid(type, draft, colsLoaded ? columns : []);
  const paramsOk = !!type && paramsValid(type, draft);
  const maxReachable = !version ? STEP.Dataset : !type ? STEP.Analysis : !varsOk ? STEP.Variables : !paramsOk ? STEP.Configuration : STEP.Run;
  const cur = Math.min(step, maxReachable);
  const go = (n: number) => setStep(Math.max(0, Math.min(n, maxReachable)));
  const edit = (fn: (d: Draft) => Draft) => { setDraft(fn); setServerError(null); };

  const submit = () => {
    if (!type || !version) return;
    setServerError(null);
    run.mutate({ dataset_version_id: version.id, analysis_type: type.type, config: buildConfig(type, draft), ...(draft.title.trim() && { title: draft.title.trim() }) }, {
      onSuccess: ({ analysis, job, reused }) => {
        const to = `/projects/${pid}/analysis/${analysis.id}`;
        if (reused) { toast.info("This exact analysis already exists — opened the saved result"); navigate(to, { state: { reused: true } }); return; }
        if (job) track(job, { title: analysis.title, silent: true, invalidate: [qk.analysis(analysis.id), ["project", pid, "analyses"], ["project", pid, "insights"]] });
        if (!job || TERMINAL.has(job.status)) navigate(to);
        else setRunning({ analysisId: analysis.id, jobId: job.id });
      },
      onError: (e) => {
        const message = errorMessage(e);
        const configError = e instanceof ApiError && e.code === "INVALID_ANALYSIS_CONFIGURATION";
        setServerError({ message, step: configError ? stepForError(message, type, draft) : STEP.Run });
        if (configError) setStep(stepForError(message, type, draft));
      },
    });
  };

  if (types.isLoading || active.loading) return <div><PageHeader title="New analysis" /><SkeletonCards n={3} /></div>;
  if (types.isError) return <ErrorState error={types.error} onRetry={() => types.refetch()} title="Couldn’t load the analysis catalogue" />;
  if (!active.datasets.length) {
    return (
      <div>
        <PageHeader eyebrow="Analysis" title="New analysis" />
        <EmptyState icon={<Database />} title="Add a dataset first" description="Analyses run on a dataset version. Upload data to get started." action={<Button asChild><Link to={`/projects/${pid}/data`}>Go to Data</Link></Button>} />
      </div>
    );
  }

  const intro = STEP_INTRO[cur];
  const stepError = serverError && serverError.step === cur ? serverError.message : null;

  return (
    <div className="max-w-3xl">
      <PageHeader eyebrow="Analysis" title="New analysis" description="A guided path from question to result. You can go back at any step." />
      <Stepper steps={STEP_LABELS} current={cur} maxReachable={maxReachable} onSelect={go} />
      {!canRun && project && <Alert variant="info" className="mb-4" title="View-only access">Viewers can explore the builder but can’t run analyses. Ask a project editor for access.</Alert>}

      <section aria-labelledby="step-h" className="space-y-4">
        <div><h2 id="step-h" className="font-display text-xl font-semibold">{intro.title}</h2><p className="text-sm text-muted-foreground">{intro.text}</p></div>
        {stepError && <Alert variant="error" title={cur === STEP.Run ? "The analysis couldn’t be started" : "Please adjust this step"}>{stepError}</Alert>}

        {cur === STEP.Dataset && <DatasetStep />}
        {cur === STEP.Analysis && <TypeStep types={types.data ?? []} columns={columns} loaded={colsLoaded} selected={draft.type} onSelect={(t) => { if (t.type !== draft.type) edit(() => ({ ...emptyDraft, type: t.type, params: defaultParams(t) })); setStep(STEP.Variables); }} />}
        {cur === STEP.Variables && type && (colsLoaded
          ? <VariableStep type={type} columns={columns} draft={draft} onChange={(k, names) => edit((d) => ({ ...d, vars: { ...d.vars, [k]: names } }))} />
          : profile.isError ? <ErrorState error={profile.error} onRetry={() => profile.refetch()} title="Couldn’t load the dataset’s columns" /> : <SkeletonCards n={1} className="sm:grid-cols-1 lg:grid-cols-1" />)}
        {cur === STEP.Configuration && type && <ParameterStep type={type} draft={draft} columns={columns} onChange={(k, v) => edit((d) => ({ ...d, params: { ...d.params, [k]: v } }))} />}
        {cur === STEP.Run && type && version && (
          running ? <RunningPanel pid={pid} running={running} /> : (
            <ReviewStep type={type} draft={draft} columns={columns} datasetName={dataset?.name ?? ""} versionNumber={version.version_number} rows={version.row_count}
              onTitle={(title) => edit((d) => ({ ...d, title }))} onEditStep={go} />
          )
        )}

        {!running && (
          <div className="flex items-center justify-between gap-3 border-t pt-4">
            <Button variant="ghost" onClick={() => go(cur - 1)} disabled={cur === 0 || run.isPending}><ArrowLeft />Back</Button>
            {cur < STEP.Run ? (
              <Button disabled={cur >= maxReachable} onClick={() => go(cur + 1)}>Continue<ArrowRight /></Button>
            ) : (
              <Button size="lg" onClick={submit} loading={run.isPending} disabled={!canRun || !type || !version}><Play />Run analysis</Button>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function DatasetStep() {
  const { datasets, dataset, version, versions, setDataset, setVersion } = useActiveDataset();
  const ready = datasets.filter((d) => d.status === "READY");
  return (
    <div className="space-y-4 rounded-xl border bg-card p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Dataset" htmlFor="b-dataset"><SimpleSelect id="b-dataset" value={dataset?.id} onValueChange={setDataset} options={ready.map((d) => ({ value: d.id, label: d.name }))} placeholder="Select a dataset" /></Field>
        <Field label="Version" htmlFor="b-version" hint="Newer versions include cleaning steps applied after upload.">
          <SimpleSelect id="b-version" value={version?.id} onValueChange={setVersion} options={[...versions].reverse().map((v) => ({ value: v.id, label: `v${v.version_number} — ${v.label}` }))} placeholder="Select a version" />
        </Field>
      </div>
      {version && <p className="tabular text-sm text-muted-foreground">This version has <span className="font-medium text-foreground">{fmtNumber(version.row_count)} rows</span> and <span className="font-medium text-foreground">{fmtNumber(version.column_count)} columns</span>.</p>}
      {!ready.length && <Alert variant="warning">No dataset is ready yet. Wait for processing to finish, or upload one on the Data page.</Alert>}
    </div>
  );
}

function TypeStep({ types, columns, loaded, selected, onSelect }: { types: AnalysisType[]; columns: Column[]; loaded: boolean; selected?: string; onSelect: (t: AnalysisType) => void }) {
  const groups = useMemo(() => {
    const m = new Map<string, AnalysisType[]>();
    types.forEach((t) => m.set(t.category, [...(m.get(t.category) ?? []), t]));
    return [...m];
  }, [types]);
  return (
    <div className="space-y-6">
      {groups.map(([cat, list]) => (
        <div key={cat} className="space-y-2" role="group" aria-label={titleCase(cat)}>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{titleCase(cat)}</h3>
          <ul className="grid gap-3 sm:grid-cols-2">
            {list.map((t) => {
              const why = loaded ? unavailableReason(t, columns) : null;
              return (
                <li key={t.type}>
                  <button type="button" disabled={!!why} aria-pressed={selected === t.type} onClick={() => onSelect(t)} aria-describedby={why ? `why-${t.type}` : undefined}
                    className={cn("flex h-full w-full flex-col gap-1 rounded-xl border bg-card p-4 text-left shadow-xs transition-colors enabled:hover:border-primary disabled:cursor-not-allowed disabled:bg-muted/40", selected === t.type && "border-primary ring-1 ring-primary")}>
                    <span className="text-[15px] font-semibold">{t.label}</span>
                    <span className="text-[13px] text-muted-foreground">{t.description}</span>
                    {why && <span id={`why-${t.type}`} className="mt-1 text-xs text-warning">{why}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

function ReviewStep({ type, draft, columns, datasetName, versionNumber, rows, onTitle, onEditStep }: {
  type: AnalysisType; draft: Draft; columns: Column[]; datasetName: string; versionNumber: number; rows: number; onTitle: (t: string) => void; onEditStep: (n: number) => void;
}) {
  const parts = type.roles.filter((r) => (draft.vars[r.key] ?? []).length).map((r) => `${r.label.toLowerCase()} ${(draft.vars[r.key] ?? []).join(", ")}`);
  const settings = type.parameters.map((p) => {
    const v = draft.params[p.key];
    if (v === null || v === undefined || v === "") return null;
    const label = p.options?.find((o) => o.value === v)?.label ?? (typeof v === "boolean" ? (v ? "on" : "off") : String(v));
    return `${p.label.toLowerCase()}: ${label}`;
  }).filter(Boolean);
  const chosen = [...new Set(Object.values(draft.vars).flat())];
  const withMissing = chosen.map((n) => columns.find((c) => c.name === n)).filter((c): c is Column => !!c && c.missing_count > 0);
  return (
    <div className="space-y-4">
      <div className="petal border bg-card p-5">
        <p className="text-[15px] leading-relaxed" data-testid="review-sentence">
          Lotus will run <strong>{type.label}</strong> on <strong>{datasetName}</strong> (version {versionNumber}) using {parts.join(" and ")}.
          {settings.length > 0 && <> Settings — {settings.join("; ")}.</>}
        </p>
        <dl className="tabular mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <div className="flex gap-2"><dt className="text-muted-foreground">Rows available</dt><dd className="font-medium">{fmtNumber(rows)}</dd></div>
          <div className="flex gap-2"><dt className="text-muted-foreground">Variables</dt><dd className="font-medium">{chosen.length}</dd></div>
        </dl>
        <p className="mt-3 text-[13px] text-muted-foreground" data-testid="missing-note">
          {withMissing.length
            ? <>Rows with a missing value in any chosen variable are left out of the calculation, and the result reports how many were used. Missing in your selection: {withMissing.map((c) => `${c.name} (${fmtNumber(c.missing_count)}, ${fmtPct(c.missing_pct)})`).join(", ")}.</>
            : "None of the chosen variables has missing values, so every row can be used."}
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          <Button variant="link" size="sm" onClick={() => onEditStep(STEP.Variables)}>Change variables</Button>
          {type.parameters.length > 0 && <Button variant="link" size="sm" onClick={() => onEditStep(STEP.Configuration)}>Change settings</Button>}
        </div>
      </div>
      <Field label="Title (optional)" htmlFor="b-title" hint="Leave empty and Lotus names it from the analysis and variables.">
        <Input id="b-title" value={draft.title} maxLength={300} onChange={(e) => onTitle(e.target.value)} />
      </Field>
    </div>
  );
}

function RunningPanel({ pid, running }: { pid: string; running: { analysisId: string; jobId: string } }) {
  const navigate = useNavigate();
  const { data: job } = useJobQuery(running.jobId);
  useEffect(() => {
    if (job && TERMINAL.has(job.status)) navigate(`/projects/${pid}/analysis/${running.analysisId}`);
  }, [job, navigate, pid, running.analysisId]);
  return (
    <div className="space-y-3 rounded-xl border bg-card p-5" aria-live="polite">
      <h3 className="font-display text-lg font-semibold">Running your analysis</h3>
      {job ? <JobProgressView job={job} /> : <p className="text-sm text-muted-foreground">Starting…</p>}
      <p className="text-xs text-muted-foreground">You’ll be taken to the result as soon as it’s ready. You can also leave this page — it keeps running.</p>
    </div>
  );
}
