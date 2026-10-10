import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Columns3, Filter, Plus, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { usePreview } from "@/api/hooks";
import type { Profile } from "@/api/types";
import { ErrorState, errorMessage, SkeletonRows } from "@/components/common/blocks";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SimpleSelect } from "@/components/ui/select";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { fmtNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { isNumeric, isOrderable, isTextual, type FilterOp } from "./model";

export interface FilterDraft { id: number; column: string; operator: FilterOp; value: string; value2: string }
interface AppliedFilter { column: string; operator: FilterOp; value?: unknown }

const OPERATORS: { value: FilterOp; label: string; kind: "any" | "order" | "text" }[] = [
  { value: "eq", label: "equals", kind: "any" }, { value: "ne", label: "does not equal", kind: "any" },
  { value: "gt", label: "greater than", kind: "order" }, { value: "gte", label: "at least", kind: "order" },
  { value: "lt", label: "less than", kind: "order" }, { value: "lte", label: "at most", kind: "order" },
  { value: "between", label: "between", kind: "order" },
  { value: "in", label: "is one of", kind: "any" }, { value: "not_in", label: "is none of", kind: "any" },
  { value: "contains", label: "contains", kind: "text" },
  { value: "is_null", label: "is missing", kind: "any" }, { value: "not_null", label: "is present", kind: "any" },
];
const operatorsFor = (semantic: string) => OPERATORS.filter((o) => o.kind === "any" || (o.kind === "order" && isOrderable(semantic)) || (o.kind === "text" && (isTextual(semantic) || semantic === "numeric_discrete")));
const PAGE_SIZES = [25, 50, 100];
let nextId = 1;

export function toApplied(f: FilterDraft): AppliedFilter {
  const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
  if (f.operator === "is_null" || f.operator === "not_null") return { column: f.column, operator: f.operator };
  if (f.operator === "between") return { column: f.column, operator: f.operator, value: [f.value.trim(), f.value2.trim()] };
  if (f.operator === "in" || f.operator === "not_in") return { column: f.column, operator: f.operator, value: list(f.value) };
  return { column: f.column, operator: f.operator, value: f.value.trim() };
}
const complete = (f: FilterDraft) => f.operator === "is_null" || f.operator === "not_null" || (f.operator === "between" ? !!f.value.trim() && !!f.value2.trim() : !!f.value.trim());

function cell(v: unknown, semantic: string) {
  if (v === null || v === undefined) return <span className="text-muted-foreground" aria-label="missing">—</span>;
  if (typeof v === "number") return <span className="tabular">{String(v)}</span>;
  if (typeof v === "boolean") return String(v);
  const s = typeof v === "string" && semantic === "datetime" ? v.replace(/T00:00:00(\.0+)?$/, "") : String(v);
  return <span className="block max-w-72 truncate" title={s}>{s}</span>;
}

export function PreviewTab({ datasetId, profile }: { datasetId: string; profile: Profile }) {
  const cols = profile.columns;
  const semanticOf = (name: string) => cols.find((c) => c.name === name)?.semantic_type ?? "text";
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[1]);
  const [sort, setSort] = useState<{ column: string; order: "asc" | "desc" } | null>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<FilterDraft[]>([]);
  const [applied, setApplied] = useState<FilterDraft[]>([]);
  const [filterOpen, setFilterOpen] = useState(false);

  const visible = cols.filter((c) => !hidden.includes(c.name)).map((c) => c.name);
  const params = useMemo(() => ({
    version_id: profile.version.id, page, page_size: pageSize,
    sort: sort?.column, order: sort ? sort.order : undefined,
    filters: applied.length ? JSON.stringify(applied.map(toApplied)) : undefined,
    columns: hidden.length ? visible.join(",") : undefined,
  }), [profile.version.id, page, pageSize, sort, applied, hidden.length, visible]);
  const { data, error, isLoading, isFetching, refetch } = usePreview(datasetId, params);

  const toggleSort = (column: string) => {
    setPage(1);
    setSort((s) => (s?.column !== column ? { column, order: "asc" } : s.order === "asc" ? { column, order: "desc" } : null));
  };
  const apply = () => { setApplied(drafts.filter(complete)); setPage(1); setFilterOpen(false); };
  const removeApplied = (id: number) => { const next = applied.filter((f) => f.id !== id); setApplied(next); setDrafts(next); setPage(1); };
  const blankDraft = (): FilterDraft => ({ id: nextId++, column: cols[0]?.name ?? "", operator: "eq", value: "", value2: "" });
  const addDraft = () => setDrafts((d) => [...d, blankDraft()]);
  const patchDraft = (id: number, p: Partial<FilterDraft>) => setDrafts((d) => d.map((f) => (f.id === id ? { ...f, ...p } : f)));

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;
  const from = data && data.total ? data.row_offset + 1 : 0;
  const to = data ? data.row_offset + data.rows.length : 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Popover open={filterOpen} onOpenChange={(o) => { setFilterOpen(o); if (o) setDrafts(applied.length ? applied : [blankDraft()]); }}>
          <PopoverTrigger asChild><Button variant="secondary" size="sm"><Filter />Filters{applied.length > 0 && <Badge variant="primary">{applied.length}</Badge>}</Button></PopoverTrigger>
          <PopoverContent align="start" className="w-[min(34rem,calc(100vw-2rem))] space-y-3 p-4">
            <p className="text-sm font-medium">Show only rows where…</p>
            {!drafts.length && <p className="text-[13px] text-muted-foreground">No conditions yet. Add one to narrow the rows.</p>}
            {drafts.map((f, i) => (
              <FilterRow key={f.id} f={f} index={i} cols={cols.map((c) => ({ name: c.name, semantic_type: c.semantic_type }))} semantic={semanticOf(f.column)} onChange={(p) => patchDraft(f.id, p)} onRemove={() => setDrafts((d) => d.filter((x) => x.id !== f.id))} />
            ))}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button variant="ghost" size="sm" onClick={addDraft}><Plus />Add condition</Button>
              <Button size="sm" onClick={apply}>Apply filters</Button>
            </div>
          </PopoverContent>
        </Popover>

        <Popover>
          <PopoverTrigger asChild><Button variant="secondary" size="sm"><Columns3 />Columns<span className="tabular text-muted-foreground">{visible.length}/{cols.length}</span></Button></PopoverTrigger>
          <PopoverContent align="start" className="w-64 p-2">
            <div className="flex items-center justify-between px-2 pb-1"><span className="text-xs font-medium text-muted-foreground">Visible columns</span><Button variant="link" size="xs" onClick={() => { setHidden([]); setPage(1); }}>Show all</Button></div>
            <ul className="scroll-thin max-h-72 overflow-y-auto">
              {cols.map((c) => (
                <li key={c.name} className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-muted">
                  <Checkbox id={`vis-${c.name}`} checked={!hidden.includes(c.name)} disabled={visible.length === 1 && !hidden.includes(c.name)} onCheckedChange={(v) => { setHidden((h) => (v ? h.filter((x) => x !== c.name) : [...h, c.name])); setPage(1); }} />
                  <Label htmlFor={`vis-${c.name}`} className="flex-1 truncate font-mono text-xs font-normal">{c.name}</Label>
                </li>
              ))}
            </ul>
          </PopoverContent>
        </Popover>

        {applied.map((f) => (
          <Badge key={f.id} variant="primary" className="gap-1.5 py-1 pl-2.5 pr-1.5">
            <span className="font-mono">{f.column}</span> {OPERATORS.find((o) => o.value === f.operator)?.label} {f.operator === "between" ? `${f.value} and ${f.value2}` : f.operator === "is_null" || f.operator === "not_null" ? "" : f.value}
            <button type="button" aria-label={`Remove filter on ${f.column}`} onClick={() => removeApplied(f.id)} className="rounded-full p-0.5 hover:bg-background/60"><X className="size-3" /></button>
          </Badge>
        ))}
        <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          Rows per page
          <SimpleSelect aria-label="Rows per page" className="h-8 w-20" value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(1); }} options={PAGE_SIZES.map((n) => ({ value: String(n), label: String(n) }))} />
        </span>
      </div>

      {isLoading ? <SkeletonRows n={8} /> : error && !data ? <ErrorState error={error} onRetry={() => refetch()} title="Couldn’t load the rows" /> : data && (
        <Card className="overflow-hidden">
          {error && <Alert variant="error" title="These filters can’t be applied" className="m-3">{errorMessage(error)}</Alert>}
          <div className={cn("transition-opacity", isFetching && "opacity-60")} aria-busy={isFetching}>
            <Table>
              <THead>
                <TR className="hover:bg-transparent">
                  <TH className="w-10 text-right"><span className="sr-only">Row</span>#</TH>
                  {data.columns.map((c) => {
                    const sorted = sort?.column === c.name ? sort.order : null;
                    return (
                      <TH key={c.name} aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none"} className={cn(isNumeric(c.semantic_type) && "text-right")}>
                        <button type="button" onClick={() => toggleSort(c.name)} className={cn("inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-background/60 hover:text-foreground", isNumeric(c.semantic_type) && "flex-row-reverse")} aria-label={`Sort by ${c.name}`}>
                          <span className="font-mono">{c.name}</span>
                          {sorted === "asc" ? <ArrowUp className="size-3" aria-hidden /> : sorted === "desc" ? <ArrowDown className="size-3" aria-hidden /> : <span className="size-3" aria-hidden />}
                        </button>
                      </TH>
                    );
                  })}
                </TR>
              </THead>
              <TBody>
                {data.rows.map((r, i) => (
                  <TR key={data.row_offset + i}>
                    <TD className="tabular text-right text-xs text-muted-foreground">{data.row_offset + i + 1}</TD>
                    {data.columns.map((c) => <TD key={c.name} className={cn(isNumeric(c.semantic_type) && "text-right")}>{cell(r[c.name], c.semantic_type)}</TD>)}
                  </TR>
                ))}
                {!data.rows.length && <TR><TD colSpan={data.columns.length + 1} className="py-10 text-center text-muted-foreground">No rows match these filters.</TD></TR>}
              </TBody>
            </Table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t px-3 py-2 text-xs text-muted-foreground">
            <span className="tabular" aria-live="polite">Showing {fmtNumber(from)}–{fmtNumber(to)} of {fmtNumber(data.total)} rows</span>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon-sm" aria-label="First page" disabled={page <= 1} onClick={() => setPage(1)}><ChevronsLeft /></Button>
              <Button variant="ghost" size="icon-sm" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft /></Button>
              <span className="tabular px-2">Page {fmtNumber(data.page)} of {fmtNumber(totalPages)}</span>
              <Button variant="ghost" size="icon-sm" aria-label="Next page" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}><ChevronRight /></Button>
              <Button variant="ghost" size="icon-sm" aria-label="Last page" disabled={page >= totalPages} onClick={() => setPage(totalPages)}><ChevronsRight /></Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

function FilterRow({ f, index, cols, semantic, onChange, onRemove }: {
  f: FilterDraft; index: number; cols: { name: string; semantic_type: string }[]; semantic: string; onChange: (p: Partial<FilterDraft>) => void; onRemove: () => void;
}) {
  const ops = operatorsFor(semantic);
  const noValue = f.operator === "is_null" || f.operator === "not_null";
  const n = index + 1;
  return (
    <div className="grid grid-cols-[1fr_auto] items-start gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto]" role="group" aria-label={`Condition ${n}`}>
      <SimpleSelect aria-label={`Condition ${n} column`} value={f.column} onValueChange={(column) => { const s = cols.find((c) => c.name === column)?.semantic_type ?? "text"; onChange({ column, operator: operatorsFor(s).some((o) => o.value === f.operator) ? f.operator : "eq" }); }} options={cols.map((c) => ({ value: c.name, label: c.name }))} />
      <SimpleSelect aria-label={`Condition ${n} operator`} value={f.operator} onValueChange={(operator) => onChange({ operator: operator as FilterOp })} options={ops.map((o) => ({ value: o.value, label: o.label }))} />
      <div className="col-span-2 flex gap-2 sm:col-span-1">
        {!noValue && <Input aria-label={`Condition ${n} value`} value={f.value} placeholder={f.operator === "in" || f.operator === "not_in" ? "a, b, c" : "value"} onChange={(e) => onChange({ value: e.target.value })} />}
        {f.operator === "between" && <Input aria-label={`Condition ${n} upper value`} value={f.value2} placeholder="and" onChange={(e) => onChange({ value2: e.target.value })} />}
      </div>
      <Button variant="ghost" size="icon-sm" aria-label={`Remove condition ${n}`} className="row-start-1 col-start-2 sm:col-start-4 sm:row-start-1" onClick={onRemove}><Trash2 /></Button>
    </div>
  );
}
