import { useMutation } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Eye, GitBranchPlus, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { useId, useMemo, useState, type ReactNode } from "react";
import { post } from "@/api/client";
import { qk } from "@/api/hooks";
import type { Dataset, DatasetVersion, Job, Profile } from "@/api/types";
import { errorMessage } from "@/components/common/blocks";
import { JobProgress } from "@/components/common/JobProgress";
import { Provenance } from "@/components/common/Provenance";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input, Textarea } from "@/components/ui/input";
import { Field, Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SimpleSelect } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { fmtNumber, SEMANTIC_LABEL } from "@/lib/format";
import { useJobs } from "@/lib/jobs";
import { useActiveDataset } from "@/lib/activeDataset";
import {
  columnsAfter, defaultDraft, isNumeric, isTextual, OP_META, OP_ORDER, toColInfo, toPayload, validateDraft,
  type CastTo, type ColInfo, type FillStrategy, type FilterOp, type OpDraft, type OpType, type TransformLogEntry,
} from "./model";

interface DryRun { log: TransformLogEntry[]; rows_before: number; rows_after: number; columns_after: { name: string; semantic_type: string }[]; sample: Record<string, unknown>[] }

export function PrepareTab({ dataset, version, profile, ops, setOps, onCreated }: {
  dataset: Dataset; version: DatasetVersion; profile: Profile; ops: OpDraft[]; setOps: (f: (o: OpDraft[]) => OpDraft[]) => void; onCreated: () => void;
}) {
  const { track } = useJobs();
  const { setVersion } = useActiveDataset();
  const baseCols = useMemo(() => toColInfo(profile.columns), [profile.columns]);
  const [label, setLabel] = useState("");
  const [preview, setPreview] = useState<{ result: DryRun; key: string } | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);

  const payload = useMemo(() => ops.map(toPayload), [ops]);
  const key = JSON.stringify(payload);
  const problems = ops.map(validateDraft);
  const invalid = problems.some(Boolean);
  const body = (dry: boolean) => ({ parent_version_id: version.id, label: label.trim(), operations: payload, dry_run: dry });

  const dry = useMutation({
    mutationFn: () => post<DryRun>(`/datasets/${dataset.id}/versions`, body(true)),
    onSuccess: (result) => setPreview({ result, key }),
  });
  const create = useMutation({
    mutationFn: () => post<Job>(`/datasets/${dataset.id}/versions`, body(false)),
    onSuccess: (job) => {
      setJobId(job.id);
      track(job, {
        title: "Creating the new version",
        invalidate: [qk.datasets(dataset.project_id), ["dataset", dataset.id], ["project", dataset.project_id]],
        onSuccess: (done) => {
          const vid = (done.result_ref as { version_id?: string } | null)?.version_id;
          if (vid) setVersion(vid);
          setOps(() => []); setLabel(""); setPreview(null); setJobId(null);
          onCreated();
        },
        onError: () => setJobId(null),
      });
    },
  });

  const add = (op: OpType) => { setOps((o) => [...o, defaultDraft(op, columnsAfter(baseCols, o))]); setPreview(null); dry.reset(); };
  const patch = (id: string, p: Partial<OpDraft>) => { setOps((o) => o.map((d) => (d.id === id ? { ...d, ...p } : d))); dry.reset(); };
  const move = (i: number, dir: -1 | 1) => setOps((o) => { const n = [...o]; const j = i + dir; if (j < 0 || j >= n.length) return o; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const stale = preview && preview.key !== key;
  const running = create.isPending || !!jobId;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <div className="space-y-4">
        <Alert variant="info" title="Preparing data never changes the original">
          Each run creates a new version from <b>v{version.version_number}</b>. The uploaded file and every earlier version stay exactly as they are, so you can always go back or compare.
        </Alert>

        {!ops.length ? (
          <Card className="space-y-3 p-6 text-center">
            <p className="text-sm text-muted-foreground">No steps yet. Steps run in order, top to bottom. Add the first one below, or use “Fix this” on the Overview tab.</p>
          </Card>
        ) : (
          <ol className="space-y-3" aria-label="Preparation steps">
            {ops.map((d, i) => (
              <li key={d.id}>
                <OpCard
                  draft={d} index={i} count={ops.length} problem={problems[i]} cols={columnsAfter(baseCols, ops.slice(0, i))}
                  onChange={(p) => patch(d.id, p)} onRemove={() => { setOps((o) => o.filter((x) => x.id !== d.id)); setPreview(null); dry.reset(); }} onMove={(dir) => move(i, dir)}
                />
              </li>
            ))}
          </ol>
        )}

        <div className="max-w-sm">
          <Select value="" onValueChange={(v) => add(v as OpType)}>
            <SelectTrigger aria-label="Add a step"><Plus className="size-4 shrink-0" aria-hidden /><SelectValue placeholder="Add a step…" /></SelectTrigger>
            <SelectContent>
              {OP_ORDER.map((op) => <SelectItem key={op} value={op}>{OP_META[op].label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-4 xl:sticky xl:top-4 xl:self-start">
        <Card className="space-y-4 p-5">
          <div className="flex items-start justify-between gap-3">
            <div><h3 className="text-[17px] font-semibold">Check the effect first</h3><p className="text-[13px] text-muted-foreground">A dry run shows what would change. Nothing is saved.</p></div>
            <Provenance kind="computed" />
          </div>
          <Button variant="secondary" onClick={() => dry.mutate()} loading={dry.isPending} disabled={!ops.length || invalid}><Eye />Preview effect</Button>
          {invalid && ops.length > 0 && <p className="text-xs text-muted-foreground">Complete every step to preview it.</p>}
          {dry.isError && <Alert variant="error" title="This preparation can’t run">{errorMessage(dry.error)}</Alert>}
          {preview && (
            <div className="space-y-3">
              {stale && <Alert variant="warning" title="Steps changed since this preview">Preview again to see the current effect.</Alert>}
              <DryRunView result={preview.result} />
            </div>
          )}
        </Card>

        <Card className="space-y-3 p-5">
          <h3 className="flex items-center gap-2 text-[17px] font-semibold"><GitBranchPlus className="size-4 text-primary" aria-hidden />Create new version</h3>
          <Field label="Version label" htmlFor="version-label" hint="Describe the change, e.g. “Duplicates removed, region tidied”.">
            <Input id="version-label" value={label} maxLength={200} onChange={(e) => setLabel(e.target.value)} placeholder="What does this version contain?" />
          </Field>
          <Button onClick={() => create.mutate()} loading={create.isPending} disabled={!ops.length || invalid || running}><ShieldCheck />Create new version</Button>
          {create.isError && <Alert variant="error" title="The version wasn’t created">{errorMessage(create.error)}</Alert>}
          {jobId && <JobProgress jobId={jobId} />}
        </Card>
      </div>
    </div>
  );
}

function DryRunView({ result }: { result: DryRun }) {
  const names = result.columns_after.map((c) => c.name);
  return (
    <div className="space-y-3" aria-label="Preview of the effect">
      <div className="grid grid-cols-3 gap-2 text-center">
        <Tile label="Rows before" value={fmtNumber(result.rows_before)} />
        <Tile label="Rows after" value={fmtNumber(result.rows_after)} />
        <Tile label="Columns after" value={fmtNumber(result.columns_after.length)} />
      </div>
      <ol className="space-y-1.5 text-[13px]" aria-label="Step log">
        {result.log.map((l, i) => (
          <li key={i} className="flex gap-2 rounded-md bg-muted/50 px-3 py-2">
            <span className="tabular text-muted-foreground">{i + 1}.</span>
            <span className="min-w-0 flex-1"><span className="font-medium">{OP_META[l.op as OpType]?.label ?? l.op}</span><span className="block text-muted-foreground">{l.note}</span></span>
            <span className="tabular shrink-0 text-xs text-muted-foreground">{fmtNumber(l.rows_before)} → {fmtNumber(l.rows_after)} rows</span>
          </li>
        ))}
      </ol>
      <div>
        <p className="mb-1 text-xs font-medium text-muted-foreground">Sample of the result</p>
        <div className="overflow-hidden rounded-md border">
          <Table>
            <THead><TR className="hover:bg-transparent">{names.map((n) => <TH key={n} className="font-mono">{n}</TH>)}</TR></THead>
            <TBody>
              {result.sample.map((r, i) => (
                <TR key={i}>{names.map((n) => <TD key={n} className="max-w-48 truncate">{r[n] === null || r[n] === undefined ? <span className="text-muted-foreground">—</span> : <span title={String(r[n])}>{String(r[n])}</span>}</TD>)}</TR>
              ))}
            </TBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
const Tile = ({ label, value }: { label: string; value: string }) => <div className="rounded-md border bg-card px-2 py-2"><div className="text-[11px] text-muted-foreground">{label}</div><div className="tabular font-display text-xl font-semibold">{value}</div></div>;

// ── one step ──────────────────────────────────────────────────────────────────────────────
function OpCard({ draft: d, index, count, problem, cols, onChange, onRemove, onMove }: {
  draft: OpDraft; index: number; count: number; problem: string | null; cols: ColInfo[]; onChange: (p: Partial<OpDraft>) => void; onRemove: () => void; onMove: (dir: -1 | 1) => void;
}) {
  const uid = useId();
  const id = (s: string) => `${uid}-${s}`;
  const colType = (name?: string) => cols.find((c) => c.name === name)?.semantic_type ?? "";
  const opts = (pred: (c: ColInfo) => boolean = () => true) => cols.filter(pred).map((c) => ({ value: c.name, label: c.name, hint: SEMANTIC_LABEL[c.semantic_type] }));
  const colSelect = (label: string, pred?: (c: ColInfo) => boolean) => (
    <Field label={label} htmlFor={id("column")}>
      <SimpleSelect id={id("column")} value={d.column} onValueChange={(v) => onChange({ column: v })} options={opts(pred)} placeholder="Choose a column" />
    </Field>
  );
  let controls: ReactNode = null;
  switch (d.op) {
    case "drop_duplicates":
      controls = (<>
        <ColumnMultiPicker label="Compare on" cols={cols} value={d.columns ?? []} onChange={(columns) => onChange({ columns })} emptyLabel="All columns" />
        <Field label="Keep" htmlFor={id("keep")}><SimpleSelect id={id("keep")} value={d.keep} onValueChange={(keep) => onChange({ keep: keep as "first" | "last" })} options={[{ value: "first", label: "First occurrence" }, { value: "last", label: "Last occurrence" }]} /></Field>
      </>); break;
    case "drop_missing":
      controls = (<>
        <ColumnMultiPicker label="Look for gaps in" cols={cols} value={d.columns ?? []} onChange={(columns) => onChange({ columns })} emptyLabel="All columns" />
        <Field label="Remove a row when" htmlFor={id("how")}><SimpleSelect id={id("how")} value={d.how} onValueChange={(how) => onChange({ how: how as "any" | "all" })} options={[{ value: "any", label: "Any of these is missing" }, { value: "all", label: "All of these are missing" }]} /></Field>
      </>); break;
    case "fill_missing": {
      const numeric = isNumeric(colType(d.column));
      const strategies: { value: FillStrategy; label: string }[] = [
        ...(numeric ? [{ value: "mean" as const, label: "Mean" }, { value: "median" as const, label: "Median" }] : []),
        { value: "mode", label: "Most common value" }, { value: "constant", label: "A fixed value" }, { value: "forward_fill", label: "Previous row’s value" },
      ];
      controls = (<>
        {colSelect("Column")}
        <Field label="Fill with" htmlFor={id("strategy")}><SimpleSelect id={id("strategy")} value={d.strategy} onValueChange={(strategy) => onChange({ strategy: strategy as FillStrategy })} options={strategies} /></Field>
        {d.strategy === "constant" && <Field label="Value" htmlFor={id("value")}><Input id={id("value")} value={d.value ?? ""} onChange={(e) => onChange({ value: e.target.value })} /></Field>}
      </>);
      if (!numeric && (d.strategy === "mean" || d.strategy === "median")) controls = <>{controls}<p className="col-span-full text-xs text-warning">Mean and median need a numeric column. Pick another strategy.</p></>;
      break;
    }
    case "rename_column":
      controls = (<>{colSelect("Column")}<Field label="New name" htmlFor={id("newName")}><Input id={id("newName")} value={d.newName ?? ""} maxLength={200} onChange={(e) => onChange({ newName: e.target.value })} /></Field></>); break;
    case "cast_type":
      controls = (<>
        {colSelect("Column")}
        <Field label="Convert to" htmlFor={id("to")}><SimpleSelect id={id("to")} value={d.to} onValueChange={(to) => onChange({ to: to as CastTo })} options={[{ value: "numeric", label: "Number (decimal)" }, { value: "integer", label: "Whole number" }, { value: "text", label: "Text" }, { value: "datetime", label: "Date/time" }, { value: "boolean", label: "True / false" }]} /></Field>
        <Field label="Values that can’t convert" htmlFor={id("errors")} hint={d.errors === "raise" ? "The step fails if any value cannot be converted." : "They become missing."}>
          <SimpleSelect id={id("errors")} value={d.errors} onValueChange={(errors) => onChange({ errors: errors as "coerce" | "raise" })} options={[{ value: "coerce", label: "Become missing" }, { value: "raise", label: "Stop with an error" }]} />
        </Field>
        {d.to === "datetime" && (<>
          <div className="flex items-center gap-2 pt-6"><Switch id={id("dayfirst")} checked={!!d.dayfirst} onCheckedChange={(dayfirst) => onChange({ dayfirst })} /><Label htmlFor={id("dayfirst")} className="font-normal">Day comes first (31/12/2026)</Label></div>
          <Field label="Date format (optional)" htmlFor={id("format")} hint="e.g. %d/%m/%Y"><Input id={id("format")} value={d.format ?? ""} onChange={(e) => onChange({ format: e.target.value })} /></Field>
        </>)}
      </>); break;
    case "filter_rows": {
      const ct = colType(d.column);
      const ops: { value: FilterOp; label: string }[] = [
        { value: "eq", label: "equals" }, { value: "ne", label: "does not equal" },
        ...(isNumeric(ct) || ct === "datetime" ? [{ value: "gt" as const, label: "greater than" }, { value: "gte" as const, label: "at least" }, { value: "lt" as const, label: "less than" }, { value: "lte" as const, label: "at most" }, { value: "between" as const, label: "between" }] : []),
        { value: "in", label: "is one of" }, { value: "not_in", label: "is none of" },
        ...(isTextual(ct) || ct === "numeric_discrete" ? [{ value: "contains" as const, label: "contains" }] : []),
        { value: "is_null", label: "is missing" }, { value: "not_null", label: "is present" },
      ];
      const noValue = d.operator === "is_null" || d.operator === "not_null";
      controls = (<>
        {colSelect("Keep rows where")}
        <Field label="Condition" htmlFor={id("operator")}><SimpleSelect id={id("operator")} value={d.operator} onValueChange={(operator) => onChange({ operator: operator as FilterOp })} options={ops} /></Field>
        {!noValue && <Field label={d.operator === "between" ? "From" : d.operator === "in" || d.operator === "not_in" ? "Values (comma-separated)" : "Value"} htmlFor={id("value")}><Input id={id("value")} value={d.value ?? ""} onChange={(e) => onChange({ value: e.target.value })} /></Field>}
        {d.operator === "between" && <Field label="To" htmlFor={id("value2")}><Input id={id("value2")} value={d.value2 ?? ""} onChange={(e) => onChange({ value2: e.target.value })} /></Field>}
      </>); break;
    }
    case "normalize_categories":
      controls = (<>
        {colSelect("Column", (c) => isTextual(c.semantic_type) || c.semantic_type === "numeric_discrete")}
        <Field label="Letter case" htmlFor={id("case")}><SimpleSelect id={id("case")} value={d.caseMode} onValueChange={(caseMode) => onChange({ caseMode: caseMode as OpDraft["caseMode"] })} options={[{ value: "none", label: "Leave as is" }, { value: "lower", label: "lowercase" }, { value: "upper", label: "UPPERCASE" }, { value: "title", label: "Title Case" }]} /></Field>
        <div className="flex items-center gap-2"><Switch id={id("strip")} checked={d.strip ?? true} onCheckedChange={(strip) => onChange({ strip })} /><Label htmlFor={id("strip")} className="font-normal">Trim leading/trailing spaces</Label></div>
        <div className="flex items-center gap-2"><Switch id={id("collapse")} checked={d.collapse ?? true} onCheckedChange={(collapse) => onChange({ collapse })} /><Label htmlFor={id("collapse")} className="font-normal">Collapse repeated spaces</Label></div>
        <Field label="Merge variants (optional)" htmlFor={id("mapping")} hint="One per line:  N. America => North America" className="col-span-full"><Textarea id={id("mapping")} rows={2} value={d.mapping ?? ""} onChange={(e) => onChange({ mapping: e.target.value })} /></Field>
      </>); break;
    case "handle_outliers":
      controls = (<>
        {colSelect("Column", (c) => isNumeric(c.semantic_type))}
        <Field label="Detect with" htmlFor={id("method")}><SimpleSelect id={id("method")} value={d.method} onValueChange={(method) => onChange({ method: method as "iqr" | "zscore", threshold: method === "iqr" ? "1.5" : "3" })} options={[{ value: "iqr", label: "IQR rule (Tukey fences)" }, { value: "zscore", label: "Z-score" }]} /></Field>
        <Field label={d.method === "zscore" ? "Threshold (standard deviations)" : "Threshold (× IQR)"} htmlFor={id("threshold")}><Input id={id("threshold")} inputMode="decimal" value={d.threshold ?? ""} onChange={(e) => onChange({ threshold: e.target.value })} /></Field>
        <Field label="Then" htmlFor={id("action")}><SimpleSelect id={id("action")} value={d.action} onValueChange={(action) => onChange({ action: action as "remove" | "clip" | "set_missing" })} options={[{ value: "set_missing", label: "Set to missing" }, { value: "clip", label: "Cap at the limits" }, { value: "remove", label: "Remove the rows" }]} /></Field>
      </>); break;
    case "select_columns":
      controls = <ColumnMultiPicker label="Columns to keep" cols={cols} value={d.columns ?? []} onChange={(columns) => onChange({ columns })} emptyLabel="Choose columns" />; break;
    case "drop_columns":
      controls = <ColumnMultiPicker label="Columns to remove" cols={cols} value={d.columns ?? []} onChange={(columns) => onChange({ columns })} emptyLabel="Choose columns" />; break;
  }

  return (
    <Card className={problem ? "border-warning/50" : undefined} role="group" aria-label={`Step ${index + 1}: ${OP_META[d.op].label}`}>
      <div className="flex items-center gap-2 border-b px-4 py-2.5">
        <span className="tabular flex size-6 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">{index + 1}</span>
        <div className="min-w-0 flex-1"><h3 className="truncate text-sm font-semibold">{OP_META[d.op].label}</h3></div>
        <Button variant="ghost" size="icon-sm" aria-label={`Move step ${index + 1} up`} disabled={index === 0} onClick={() => onMove(-1)}><ArrowUp /></Button>
        <Button variant="ghost" size="icon-sm" aria-label={`Move step ${index + 1} down`} disabled={index === count - 1} onClick={() => onMove(1)}><ArrowDown /></Button>
        <Button variant="ghost" size="icon-sm" aria-label={`Remove step ${index + 1}`} onClick={onRemove}><Trash2 /></Button>
      </div>
      <div className="grid gap-x-4 gap-y-3 p-4 sm:grid-cols-2">{controls}</div>
      <p className="px-4 pb-3 text-xs text-muted-foreground">{problem ? <span className="text-warning">{problem}</span> : OP_META[d.op].help}</p>
    </Card>
  );
}

function ColumnMultiPicker({ label, cols, value, onChange, emptyLabel }: { label: string; cols: ColInfo[]; value: string[]; onChange: (v: string[]) => void; emptyLabel: string }) {
  const uid = useId();
  const [q, setQ] = useState("");
  const shown = cols.filter((c) => c.name.toLowerCase().includes(q.toLowerCase()));
  const summary = value.length === 0 ? emptyLabel : value.length <= 2 ? value.join(", ") : `${value.length} columns`;
  return (
    <div className="space-y-1.5">
      <Label id={`${uid}-l`}>{label}</Label>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="secondary" className="w-full justify-between font-normal" aria-labelledby={`${uid}-l ${uid}-b`}><span id={`${uid}-b`} className="truncate">{summary}</span>{value.length > 0 && <Badge variant="primary">{value.length}</Badge>}</Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-2">
          <Input aria-label="Filter columns" placeholder="Filter columns" value={q} onChange={(e) => setQ(e.target.value)} className="mb-2 h-8" />
          <div className="mb-1 flex justify-between px-1">
            <Button variant="link" size="xs" onClick={() => onChange(cols.map((c) => c.name))}>Select all</Button>
            <Button variant="link" size="xs" onClick={() => onChange([])}>Clear</Button>
          </div>
          <ul className="scroll-thin max-h-60 overflow-y-auto">
            {shown.map((c) => (
              <li key={c.name} className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-muted">
                <Checkbox id={`${uid}-${c.name}`} checked={value.includes(c.name)} onCheckedChange={(on) => onChange(on ? [...value, c.name] : value.filter((x) => x !== c.name))} />
                <Label htmlFor={`${uid}-${c.name}`} className="flex-1 truncate font-mono text-xs font-normal">{c.name}</Label>
                <span className="text-[11px] text-muted-foreground">{SEMANTIC_LABEL[c.semantic_type] ?? ""}</span>
              </li>
            ))}
            {!shown.length && <li className="px-2 py-3 text-center text-xs text-muted-foreground">No matching column.</li>}
          </ul>
        </PopoverContent>
      </Popover>
    </div>
  );
}
