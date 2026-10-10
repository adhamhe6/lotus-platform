import { useMemo, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/label";
import { SimpleSelect } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtDate, titleCase } from "@/lib/format";
import { useAnalysesForReport, useInsightsList, useMixedRuns, useThemeRuns, useVersionIndex, useVisualizationsList, type Section } from "./reportsApi";
import { kindLabel, makeSection } from "./sections";

/** Picks the real project resource a section embeds, then returns a section whose `ref` matches what the server validates. */
export function AddSectionDialog({ pid, type, onClose, onAdd }: { pid: string; type: string | null; onClose: () => void; onAdd: (s: Section) => void }) {
  return (
    <Dialog open={!!type} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        {type && <Body key={type} pid={pid} type={type} onAdd={onAdd} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function Body({ pid, type, onAdd, onClose }: { pid: string; type: string; onAdd: (s: Section) => void; onClose: () => void }) {
  const [build, setBuild] = useState<(() => Section) | null>(null);
  const Picker = { findings: Findings, analysis: AnalysisPicker, visualization: VizPicker, themes: ThemesPicker, mixed: MixedPicker, dataset: DatasetPicker }[type];
  return (
    <>
      <DialogHeader>
        <DialogTitle>Add {kindLabel(type).toLowerCase()} section</DialogTitle>
        <DialogDescription>Choose what to include. The section always shows the stored result, so the numbers in the report match the rest of the project.</DialogDescription>
      </DialogHeader>
      {Picker && <Picker pid={pid} onPick={(fn) => setBuild(() => fn)} />}
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button disabled={!build} onClick={() => build && onAdd(build())}>Add section</Button>
      </DialogFooter>
    </>
  );
}

type PickerProps = { pid: string; onPick: (build: (() => Section) | null) => void };
const Loading = () => <div className="space-y-2" aria-busy aria-label="Loading"><Skeleton className="h-9" /><Skeleton className="h-9" /></div>;
const None = ({ children }: { children: string }) => <Alert variant="info">{children}</Alert>;

function Findings({ pid, onPick }: PickerProps) {
  const q = useInsightsList(pid);
  const [sel, setSel] = useState<string[]>([]);
  const toggle = (id: string, on: boolean) => {
    const next = on ? [...sel, id] : sel.filter((x) => x !== id);
    setSel(next);
    onPick(next.length ? () => makeSection("findings", "Key findings", { insight_ids: next }) : null);
  };
  if (q.isLoading) return <Loading />;
  if (!q.data?.length) return <None>This project has no insights yet. Generate insights from completed analyses first.</None>;
  return (
    <fieldset className="max-h-72 space-y-1 overflow-y-auto">
      <legend className="mb-1 text-[13px] font-medium">Insights to include</legend>
      {q.data.map((i) => (
        <label key={i.id} className="flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted/60">
          <Checkbox className="mt-1" checked={sel.includes(i.id)} onCheckedChange={(c) => toggle(i.id, c === true)} aria-label={i.title} />
          <span className="min-w-0 text-sm"><span className="block font-medium leading-snug">{i.title}</span><span className="text-xs text-muted-foreground">{titleCase(i.qualification)} evidence</span></span>
        </label>
      ))}
    </fieldset>
  );
}

function AnalysisPicker({ pid, onPick }: PickerProps) {
  const q = useAnalysesForReport(pid);
  const [id, setId] = useState<string>();
  const [charts, setCharts] = useState(true);
  const [tables, setTables] = useState(true);
  const emit = (nid: string | undefined, c: boolean, t: boolean) => {
    const a = q.data?.find((x) => x.id === nid);
    onPick(a ? () => makeSection("analysis", a.title, { analysis_run_id: a.id, charts: c, tables: t }) : null);
  };
  if (q.isLoading) return <Loading />;
  if (!q.data?.length) return <None>No completed analyses yet. Run an analysis first.</None>;
  return (
    <div className="space-y-3">
      <Field label="Analysis" htmlFor="pick-analysis">
        <SimpleSelect id="pick-analysis" value={id} placeholder="Choose an analysis" onValueChange={(v) => { setId(v); emit(v, charts, tables); }} options={q.data.map((a) => ({ value: a.id, label: a.title, hint: titleCase(a.analysis_type) }))} />
      </Field>
      <div className="flex gap-5 text-sm">
        <label className="flex items-center gap-2"><Checkbox checked={tables} onCheckedChange={(c) => { setTables(c === true); emit(id, charts, c === true); }} />Include tables</label>
        <label className="flex items-center gap-2"><Checkbox checked={charts} onCheckedChange={(c) => { setCharts(c === true); emit(id, c === true, tables); }} />Include charts</label>
      </div>
    </div>
  );
}

function VizPicker({ pid, onPick }: PickerProps) {
  const q = useVisualizationsList(pid);
  const [id, setId] = useState<string>();
  if (q.isLoading) return <Loading />;
  if (!q.data?.length) return <None>No saved visualizations yet. Save a chart in the visualization studio first.</None>;
  return (
    <Field label="Saved visualization" htmlFor="pick-viz">
      <SimpleSelect id="pick-viz" value={id} placeholder="Choose a chart" onValueChange={(v) => { setId(v); const x = q.data!.find((z) => z.id === v); onPick(x ? () => makeSection("visualization", x.name, { visualization_id: x.id }) : null); }} options={q.data.map((v) => ({ value: v.id, label: v.name }))} />
    </Field>
  );
}

function MixedPicker({ pid, onPick }: PickerProps) {
  const q = useMixedRuns(pid);
  const [id, setId] = useState<string>();
  if (q.isLoading) return <Loading />;
  if (!q.data?.length) return <None>No mixed-methods runs yet. Run one from the Mixed methods page first.</None>;
  const label = (m: { outcome_column: string; column_name: string }) => `${m.outcome_column} × themes in “${m.column_name}”`;
  return (
    <Field label="Mixed-methods run" htmlFor="pick-mixed">
      <SimpleSelect id="pick-mixed" value={id} placeholder="Choose a run" onValueChange={(v) => { setId(v); const m = q.data!.find((z) => z.id === v); onPick(m ? () => makeSection("mixed", `Mixed-methods integration — ${m.outcome_column}`, { mixed_run_id: m.id }) : null); }} options={q.data.map((m) => ({ value: m.id, label: label(m), hint: fmtDate(m.created_at) }))} />
    </Field>
  );
}

function VersionSelect({ pid, value, onChange, id }: { pid: string; value?: string; onChange: (v: string) => void; id: string }) {
  const { versions, loading } = useVersionIndex(pid);
  if (loading) return <Loading />;
  if (!versions.length) return <None>This project has no dataset versions yet.</None>;
  return <SimpleSelect id={id} value={value} placeholder="Choose a dataset version" onValueChange={onChange} options={versions.map((v) => ({ value: v.id, label: `${v.datasetName} · v${v.number}`, hint: v.label }))} />;
}

function DatasetPicker({ pid, onPick }: PickerProps) {
  const { versions } = useVersionIndex(pid);
  const [id, setId] = useState<string>();
  return (
    <Field label="Dataset version" htmlFor="pick-dataset">
      <VersionSelect pid={pid} id="pick-dataset" value={id} onChange={(v) => { setId(v); const x = versions.find((z) => z.id === v); onPick(x ? () => makeSection("dataset", `Data — ${x.datasetName} v${x.number}`, { dataset_version_id: x.id }) : null); }} />
    </Field>
  );
}

function ThemesPicker({ pid, onPick }: PickerProps) {
  const [version, setVersion] = useState<string>();
  const [run, setRun] = useState<string>();
  const runs = useThemeRuns(pid, version);
  const options = useMemo(() => (runs.data ?? []).map((r) => ({ value: r.id, label: `Column “${r.params.column ?? "text"}”`, hint: `${r.k ?? "?"} themes · ${fmtDate(r.created_at)}` })), [runs.data]);
  return (
    <div className="space-y-3">
      <Field label="Dataset version" htmlFor="pick-theme-version">
        <VersionSelect pid={pid} id="pick-theme-version" value={version} onChange={(v) => { setVersion(v); setRun(undefined); onPick(null); }} />
      </Field>
      {version && (runs.isLoading ? <Loading /> : options.length === 0 ? <None>No theme detection has been run on this version. Detect themes on the Qualitative page first.</None> : (
        <Field label="Theme detection run" htmlFor="pick-theme-run">
          <SimpleSelect
            id="pick-theme-run" value={run} placeholder="Choose a run" options={options}
            onValueChange={(v) => { setRun(v); const r = runs.data!.find((z) => z.id === v)!; onPick(() => makeSection("themes", `Qualitative themes — ${r.params.column ?? "text"}`, { column: r.params.column, run_id: r.id, dataset_version_id: version })); }}
          />
        </Field>
      ))}
    </div>
  );
}
