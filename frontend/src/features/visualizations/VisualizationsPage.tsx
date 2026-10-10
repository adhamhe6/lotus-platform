import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, Database, Lightbulb, Save, Trash2, Wand2 } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { ApiError, del, get, post } from "@/api/client";
import { qk } from "@/api/hooks";
import type { ChartSpec, Visualization } from "@/api/types";
import { ChartView } from "@/components/charts/ChartView";
import { EmptyState, ErrorState, errorMessage, PageHeader, Section, SkeletonCards, SkeletonRows } from "@/components/common/blocks";
import { Provenance } from "@/components/common/Provenance";
import { Alert } from "@/components/ui/alert";
import { ConfirmDialog } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Field, Label } from "@/components/ui/label";
import { SimpleSelect } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useActiveDataset } from "@/lib/activeDataset";
import { fmtDate } from "@/lib/format";
import { useProjectId } from "@/lib/useProjectId";
import { cn } from "@/lib/utils";
import { useCanEdit } from "@/features/data/shared";
import {
  AGGREGATIONS, buildRequest, FREQUENCIES, fromRequest, fromSuggestion, KINDS, kindLabel, matchesRole, missingInput, NEW_STATE, sanitize, slotsFor, suggestionTitle, usesAggregation, usesTopN,
  type Aggregation, type ChartKindId, type ChartState, type ChartSuggestion, type Frequency,
} from "./chartRequest";

const DEBOUNCE_MS = 400;
const NONE = "__none__";

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export function VisualizationsPage() {
  const pid = useProjectId();
  const qc = useQueryClient();
  const { dataset, version, columns, loading } = useActiveDataset();
  const { canEdit } = useCanEdit(pid);
  const [state, setState] = useState<ChartState>(NEW_STATE);
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [toDelete, setToDelete] = useState<Visualization | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  const cols = useMemo(() => columns.map((c) => ({ name: c.name, semantic_type: c.semantic_type })), [columns]);
  const update = (p: Partial<ChartState>) => setState((s) => sanitize({ ...s, ...p }, cols));
  const request = useMemo(() => buildRequest(state), [state]);
  const requestKey = JSON.stringify(request);
  const debouncedKey = useDebounced(requestKey, DEBOUNCE_MS);
  const missing = missingInput(state);
  const settled = debouncedKey === requestKey;

  const preview = useQuery({
    queryKey: ["project", pid, "viz-preview", version?.id, debouncedKey],
    queryFn: () => post<ChartSpec>(`/projects/${pid}/visualizations/preview`, { ...JSON.parse(debouncedKey), dataset_version_id: version!.id }),
    enabled: !!version && !missing && settled && columns.length > 0, retry: false, staleTime: 30_000, placeholderData: keepPreviousData,
  });
  const spec = missing ? undefined : preview.data;
  const guard = !missing && preview.error instanceof ApiError && preview.error.status === 422 ? preview.error : null;
  const showSpec = !!spec && !guard;
  const canSave = canEdit && showSpec && settled && !preview.isFetching;

  const suggestions = useQuery({
    queryKey: ["dataset", dataset?.id, "chart-suggestions", version?.id],
    queryFn: () => get<ChartSuggestion[]>(`/datasets/${dataset!.id}/chart-suggestions`, { version_id: version!.id }),
    enabled: !!dataset && !!version, staleTime: 60_000,
  });
  const saved = useQuery({ queryKey: qk.visualizations(pid), queryFn: () => get<Visualization[]>(`/projects/${pid}/visualizations`) });

  const save = useMutation({
    mutationFn: () => post<Visualization>(`/projects/${pid}/visualizations`, { dataset_version_id: version!.id, name: (name.trim() || spec?.title || "Untitled chart"), request }),
    onSuccess: (v) => { qc.invalidateQueries({ queryKey: qk.visualizations(pid) }); toast.success(`Saved “${v.name}”`); setName(""); setNameTouched(false); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (v: Visualization) => del(`/visualizations/${v.id}`),
    onSuccess: (_, v) => { qc.invalidateQueries({ queryKey: qk.visualizations(pid) }); toast.success(`Deleted “${v.name}”`); setToDelete(null); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const nameValue = nameTouched ? name : name || spec?.title || "";

  const header = <PageHeader eyebrow="Analyse" title="Visualizations" description="Build a chart from any variable. Every chart is computed on the server from your data, and unsuitable combinations are explained rather than drawn." />;

  if (loading) return <div>{header}<SkeletonRows n={5} /></div>;
  if (!dataset || !version) {
    return (
      <div>{header}
        <EmptyState icon={<Database />} title="No dataset to chart yet" description="Upload a dataset (or finish processing one) and its variables will appear here."
          action={<Button asChild><Link to={`/projects/${pid}/data?upload=1`}>Upload a dataset</Link></Button>} />
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <div>
        {header}
        <p className="-mt-3 mb-5 text-[13px] text-muted-foreground">Using <Link className="font-medium text-primary hover:underline" to={`/projects/${pid}/data/${dataset.id}`}>{dataset.name}</Link>, version {version.version_number}. Change it from the dataset selector in the top bar.</p>

        <Recommended query={suggestions} onPick={(s) => { setState(sanitize(fromSuggestion(s), cols)); setNameTouched(false); setName(""); }} />

        <div className="mt-6 grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
          <Card className="space-y-5 p-5 lg:self-start">
            <KindPicker value={state.kind} onChange={(kind) => update({ kind })} />
            <Controls state={state} cols={cols} update={update} />
          </Card>

          <Card ref={previewRef} className="min-w-0 space-y-4 p-5" aria-label="Chart preview">
            <div className="flex items-center justify-between gap-2"><h2 className="text-[17px] font-semibold">Preview</h2><Provenance kind="computed" /></div>
            <div className={cn("transition-opacity", (preview.isFetching || !settled) && showSpec && "opacity-60")} aria-busy={preview.isFetching}>
              {missing ? (
                <EmptyPreview>{missing}</EmptyPreview>
              ) : guard ? (
                <Alert variant="info" title="This chart needs a change"><p>{guard.message}</p></Alert>
              ) : preview.error && !spec ? (
                <ErrorState error={preview.error} onRetry={() => preview.refetch()} title="Couldn’t build the chart" className="py-8" />
              ) : showSpec ? (
                <ChartView spec={spec} height={360} />
              ) : (
                <div className="flex h-[360px] items-center justify-center text-sm text-muted-foreground" role="status">Building chart…</div>
              )}
            </div>
            {canEdit && (
              <form className="flex flex-wrap items-end gap-3 border-t pt-4" onSubmit={(e) => { e.preventDefault(); if (canSave) save.mutate(); }}>
                <Field label="Name" htmlFor="viz-name" className="min-w-52 flex-1">
                  <Input id="viz-name" value={nameValue} maxLength={200} placeholder="Name this chart" onChange={(e) => { setName(e.target.value); setNameTouched(true); }} />
                </Field>
                <Button type="submit" loading={save.isPending} disabled={!canSave}><Save />Save chart</Button>
              </form>
            )}
          </Card>
        </div>
      </div>

      <Section title="Saved charts" description="Charts saved to this project can be included in reports.">
        {saved.isLoading ? <SkeletonCards n={3} /> : saved.error ? <ErrorState error={saved.error} onRetry={() => saved.refetch()} title="Couldn’t load saved charts" /> : !saved.data?.length ? (
          <EmptyState compact icon={<BarChart3 />} title="No saved charts yet" description={canEdit ? "Build a chart above and save it to keep it here." : "Charts saved by project editors appear here."} />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {saved.data.map((v) => (
              <li key={v.id}>
                <Card className="flex h-full flex-col">
                  <div className="flex items-start justify-between gap-2 px-4 pt-4">
                    <div className="min-w-0"><h3 className="truncate text-sm font-semibold" title={v.name}>{v.name}</h3><p className="text-xs text-muted-foreground">{kindLabel(String((v.request as { kind?: string }).kind ?? ""))} · {fmtDate(v.created_at)}</p></div>
                    {canEdit && <Button variant="ghost" size="icon-sm" aria-label={`Delete ${v.name}`} onClick={() => setToDelete(v)}><Trash2 /></Button>}
                  </div>
                  <div className="flex-1 px-4 py-3"><ChartView spec={v.spec as unknown as ChartSpec} height={180} bare /></div>
                  <div className="border-t px-4 py-2"><Button variant="link" size="xs" onClick={() => { setState(sanitize(fromRequest(v.request), cols)); setNameTouched(false); setName(""); previewRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" }); }}><Wand2 className="size-3.5" />Open in builder</Button></div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <ConfirmDialog open={!!toDelete} onOpenChange={(o) => { if (!o) setToDelete(null); }} title="Delete this chart?" loading={remove.isPending}
        description={<>“{toDelete?.name}” will be removed from this project. Reports that already include it keep their own copy.</>} confirmLabel="Delete chart" onConfirm={() => toDelete && remove.mutate(toDelete)} />
    </div>
  );
}

const EmptyPreview = ({ children }: { children: string }) => (
  <div className="flex h-[360px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-center text-sm text-muted-foreground" role="status"><BarChart3 className="size-6" aria-hidden />{children}</div>
);

function Recommended({ query, onPick }: { query: { data?: ChartSuggestion[]; isLoading: boolean; error: unknown; refetch: () => unknown }; onPick: (s: ChartSuggestion) => void }) {
  if (query.isLoading) return <div aria-busy aria-label="Loading recommended charts"><SkeletonRows n={1} /></div>;
  if (query.error) return <ErrorState error={query.error} onRetry={() => query.refetch()} title="Couldn’t load recommended charts" className="py-6" />;
  if (!query.data?.length) return null;
  return (
    <section aria-labelledby="rec-h" className="space-y-2">
      <h2 id="rec-h" className="flex items-center gap-2 text-sm font-semibold"><Lightbulb className="size-4 text-primary" aria-hidden />Recommended charts</h2>
      <ul className="scroll-thin -mx-1 flex gap-3 overflow-x-auto px-1 pb-2">
        {query.data.map((s, i) => (
          <li key={i} className="w-60 shrink-0">
            <button type="button" onClick={() => onPick(s)} className="flex h-full w-full flex-col items-start gap-1 rounded-lg border bg-card p-3 text-left shadow-xs transition-colors hover:border-primary/60 hover:bg-accent/40">
              <Badge variant="outline">{kindLabel(s.kind)}</Badge>
              <span className="text-sm font-medium leading-snug">{suggestionTitle(s)}</span>
              <span className="text-xs text-muted-foreground">{s.reason}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function KindPicker({ value, onChange }: { value: ChartKindId; onChange: (k: ChartKindId) => void }) {
  return (
    <div className="space-y-2">
      <Label id="kind-l">Chart type</Label>
      <div role="radiogroup" aria-labelledby="kind-l" className="grid grid-cols-2 gap-2">
        {KINDS.map((k) => (
          <button key={k.kind} type="button" role="radio" aria-checked={value === k.kind} title={k.help} onClick={() => onChange(k.kind)}
            className={cn("rounded-md border px-3 py-2 text-left text-[13px] font-medium transition-colors", value === k.kind ? "border-primary bg-accent text-accent-foreground" : "hover:bg-muted")}>
            {k.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{KINDS.find((k) => k.kind === value)?.help}.</p>
    </div>
  );
}

function Controls({ state, cols, update }: { state: ChartState; cols: { name: string; semantic_type: string }[]; update: (p: Partial<ChartState>) => void }) {
  const uid = useId();
  const slots = slotsFor(state);
  const numerics = cols.filter((c) => matchesRole("numeric", c.semantic_type));
  return (
    <div className="space-y-4 border-t pt-4">
      {usesAggregation(state.kind) && (
        <Field label={state.kind === "line" ? "Show" : "Bar height"} htmlFor={`${uid}-agg`}>
          <SimpleSelect id={`${uid}-agg`} value={state.aggregation} onValueChange={(v) => update({ aggregation: v as Aggregation })} options={AGGREGATIONS} />
        </Field>
      )}
      {slots.map((slot) => {
        const options = cols.filter((c) => matchesRole(slot.role, c.semantic_type)).map((c) => ({ value: c.name, label: c.name }));
        return (
          <Field key={slot.field} label={slot.label} htmlFor={`${uid}-${slot.field}`} hint={!options.length ? `No ${slot.role === "date" ? "date/time" : slot.role === "numeric" ? "numeric" : "categorical"} columns in this version.` : undefined}>
            <SimpleSelect id={`${uid}-${slot.field}`} value={state[slot.field] ?? (slot.none ? NONE : undefined)} placeholder="Choose a column" disabled={!options.length}
              onValueChange={(v) => update({ [slot.field]: v === NONE ? undefined : v })} options={slot.none ? [{ value: NONE, label: slot.none }, ...options] : options} />
          </Field>
        );
      })}
      {state.kind === "heatmap" && (
        <fieldset className="space-y-2">
          <legend className="mb-1 flex w-full items-center justify-between text-[13px] font-medium">Numeric variables
            <span className="flex gap-1"><Button type="button" variant="link" size="xs" onClick={() => update({ columns: numerics.map((c) => c.name) })}>All</Button><Button type="button" variant="link" size="xs" onClick={() => update({ columns: [] })}>None</Button></span>
          </legend>
          {!numerics.length && <p className="text-xs text-muted-foreground">No numeric columns in this version.</p>}
          <ul className="scroll-thin max-h-52 overflow-y-auto rounded-md border">
            {numerics.map((c) => (
              <li key={c.name} className="flex items-center gap-2 px-3 py-1.5 hover:bg-muted/60">
                <Checkbox id={`${uid}-c-${c.name}`} checked={state.columns.includes(c.name)} onCheckedChange={(on) => update({ columns: on ? [...state.columns, c.name] : state.columns.filter((x) => x !== c.name) })} />
                <Label htmlFor={`${uid}-c-${c.name}`} className="flex-1 truncate font-mono text-xs font-normal">{c.name}</Label>
              </li>
            ))}
          </ul>
        </fieldset>
      )}
      {state.kind === "line" && (
        <Field label="Group by period" htmlFor={`${uid}-freq`}><SimpleSelect id={`${uid}-freq`} value={state.frequency} onValueChange={(v) => update({ frequency: v as Frequency })} options={FREQUENCIES} /></Field>
      )}
      {usesTopN(state) && (
        <Field label="Show at most" htmlFor={`${uid}-top`} hint="Larger groups are kept; the rest are left out of the chart.">
          <TopNInput id={`${uid}-top`} value={state.top_n} onCommit={(n) => update({ top_n: n })} />
        </Field>
      )}
      {state.kind === "scatter" && (
        <div className="flex items-center gap-2"><Switch id={`${uid}-trend`} checked={state.trendline} onCheckedChange={(trendline) => update({ trendline })} /><Label htmlFor={`${uid}-trend`} className="font-normal">Show trend line</Label></div>
      )}
    </div>
  );
}

/** Numeric input that lets the user clear and retype; only valid values (2–50) are committed. */
function TopNInput({ id, value, onCommit }: { id: string; value: number; onCommit: (n: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <Input id={id} type="number" min={2} max={50} inputMode="numeric" value={text}
      onChange={(e) => { setText(e.target.value); const n = Number(e.target.value); if (Number.isInteger(n) && n >= 2 && n <= 50) onCommit(n); }}
      onBlur={() => setText(String(value))} />
  );
}
