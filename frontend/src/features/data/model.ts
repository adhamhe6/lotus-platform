/** Typed views over the loosely-typed JSON the dataset endpoints return, plus the pure logic of the data-preparation builder. */
import type { Column, Dataset, DatasetVersion } from "@/api/types";

// ── payload views ──────────────────────────────────────────────────────────────────────────
export interface QualityIssue { severity: string; code: string; column: string | null; message: string }
export interface Quality {
  rows: number; columns: number; missing_cells: number; missing_pct: number; complete_rows: number; duplicate_rows: number;
  type_counts: Record<string, number>; issues: QualityIssue[];
}
export interface IngestWarning { code?: string; message: string; column?: string }
export interface TransformLogEntry { op: string; note: string; rows_before: number; rows_after: number; cells_or_rows_affected: number; params: Record<string, unknown> }
export interface HistogramData { edges: number[]; counts: number[] }
export interface TopValue { value: unknown; count: number; pct?: number }

export function readQuality(v?: DatasetVersion | null): Quality | null {
  const q = v?.quality as Partial<Quality> | undefined;
  if (!q || typeof q.rows !== "number") return null;
  return {
    rows: q.rows, columns: q.columns ?? 0, missing_cells: q.missing_cells ?? 0, missing_pct: q.missing_pct ?? 0,
    complete_rows: q.complete_rows ?? 0, duplicate_rows: q.duplicate_rows ?? 0, type_counts: q.type_counts ?? {}, issues: q.issues ?? [],
  };
}

export function readWarnings(v?: DatasetVersion | null): IngestWarning[] {
  return (v?.ingest_warnings ?? []).flatMap((w): IngestWarning[] => {
    if (typeof w === "string") return [{ message: w }];
    if (w && typeof w === "object" && typeof (w as IngestWarning).message === "string") return [w as IngestWarning];
    return [];
  });
}

export function readLog(v?: DatasetVersion | null): TransformLogEntry[] {
  const log = (v?.transformation as { log?: TransformLogEntry[] } | null | undefined)?.log;
  return Array.isArray(log) ? log : [];
}

export const warningCount = (d: Dataset): number => {
  const q = readQuality(d.latest_version);
  return (q?.issues.filter((i) => i.severity === "warning" || i.severity === "error").length ?? 0) + readWarnings(d.latest_version).length;
};

export const datasetError = (d: Dataset): string | null => (d.error && typeof d.error.message === "string" ? d.error.message : d.error ? "The file could not be processed." : null);

export const isNumeric = (t: string) => t === "numeric_continuous" || t === "numeric_discrete" || t === "binary";
export const isOrderable = (t: string) => isNumeric(t) || t === "datetime";
export const isTextual = (t: string) => t === "categorical" || t === "text" || t === "identifier" || t === "boolean";
export const canEditRole = (role?: string | null) => role === "OWNER" || role === "EDITOR";

// ── data-preparation builder ───────────────────────────────────────────────────────────────
export type OpType = "drop_duplicates" | "drop_missing" | "fill_missing" | "rename_column" | "cast_type" | "filter_rows" | "normalize_categories" | "handle_outliers" | "select_columns" | "drop_columns";
export type FilterOp = "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "in" | "not_in" | "contains" | "is_null" | "not_null" | "between";
export type FillStrategy = "mean" | "median" | "mode" | "constant" | "forward_fill";
export type CastTo = "numeric" | "integer" | "text" | "datetime" | "boolean";

export interface OpDraft {
  id: string; op: OpType;
  column?: string; columns?: string[];
  keep?: "first" | "last"; how?: "any" | "all";
  strategy?: FillStrategy; value?: string; value2?: string; operator?: FilterOp;
  newName?: string;
  to?: CastTo; errors?: "coerce" | "raise"; dayfirst?: boolean; format?: string;
  strip?: boolean; collapse?: boolean; caseMode?: "none" | "lower" | "upper" | "title"; mapping?: string;
  method?: "iqr" | "zscore"; threshold?: string; action?: "remove" | "clip" | "set_missing";
}
export interface ColInfo { name: string; semantic_type: string }

export const OP_META: Record<OpType, { label: string; help: string }> = {
  drop_duplicates: { label: "Remove duplicate rows", help: "Keep one copy of rows that repeat." },
  drop_missing: { label: "Remove rows with missing values", help: "Drop rows that have gaps in the chosen columns." },
  fill_missing: { label: "Fill missing values", help: "Replace gaps in one column with a computed or fixed value." },
  rename_column: { label: "Rename a column", help: "Give a column a clearer name." },
  cast_type: { label: "Change a column's type", help: "Convert text to numbers, dates or true/false." },
  filter_rows: { label: "Keep rows matching a condition", help: "Remove rows that do not satisfy a rule." },
  normalize_categories: { label: "Tidy category labels", help: "Trim spaces, unify case and merge variants." },
  handle_outliers: { label: "Handle outliers", help: "Remove, cap or blank out extreme values." },
  select_columns: { label: "Keep only some columns", help: "Restrict the dataset to the columns you choose." },
  drop_columns: { label: "Remove columns", help: "Drop columns you do not need." },
};
export const OP_ORDER = Object.keys(OP_META) as OpType[];

let counter = 0;
export const newOpId = () => `op-${Date.now().toString(36)}-${(counter++).toString(36)}`;

export function defaultDraft(op: OpType, cols: ColInfo[] = [], patch: Partial<OpDraft> = {}): OpDraft {
  const first = (pred: (c: ColInfo) => boolean) => cols.find(pred)?.name;
  const base: OpDraft = { id: newOpId(), op };
  switch (op) {
    case "drop_duplicates": Object.assign(base, { keep: "first", columns: [] }); break;
    case "drop_missing": Object.assign(base, { how: "any", columns: [] }); break;
    case "fill_missing": Object.assign(base, { column: first((c) => isNumeric(c.semantic_type)) ?? cols[0]?.name, strategy: first((c) => isNumeric(c.semantic_type)) ? "median" : "mode", value: "" }); break;
    case "rename_column": Object.assign(base, { column: cols[0]?.name, newName: "" }); break;
    case "cast_type": Object.assign(base, { column: cols[0]?.name, to: "numeric", errors: "coerce", dayfirst: false, format: "" }); break;
    case "filter_rows": Object.assign(base, { column: cols[0]?.name, operator: "eq", value: "", value2: "" }); break;
    case "normalize_categories": Object.assign(base, { column: first((c) => c.semantic_type === "categorical") ?? first((c) => isTextual(c.semantic_type)) ?? cols[0]?.name, strip: true, collapse: true, caseMode: "none", mapping: "" }); break;
    case "handle_outliers": Object.assign(base, { column: first((c) => isNumeric(c.semantic_type)) ?? cols[0]?.name, method: "iqr", threshold: "1.5", action: "set_missing" }); break;
    case "select_columns": case "drop_columns": Object.assign(base, { columns: [] }); break;
  }
  return { ...base, ...patch };
}

/** Parse "old => new" lines. Returns null when a non-empty line is malformed. */
export function parseMapping(text: string): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const i = line.indexOf("=>");
    if (i < 1) return null;
    const from = line.slice(0, i).trim();
    if (!from) return null;
    out[from] = line.slice(i + 2).trim();
  }
  return out;
}

const splitList = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
const needsNoValue = (o?: FilterOp) => o === "is_null" || o === "not_null";

export function validateDraft(d: OpDraft): string | null {
  switch (d.op) {
    case "fill_missing":
      if (!d.column) return "Choose a column to fill.";
      if (d.strategy === "constant" && !(d.value ?? "").trim()) return "Enter the value to fill with.";
      return null;
    case "rename_column":
      if (!d.column) return "Choose a column to rename.";
      return (d.newName ?? "").trim() ? null : "Enter the new column name.";
    case "cast_type": return d.column ? null : "Choose a column to convert.";
    case "filter_rows":
      if (!d.column) return "Choose a column to filter on.";
      if (needsNoValue(d.operator)) return null;
      if (d.operator === "between") return (d.value ?? "").trim() && (d.value2 ?? "").trim() ? null : "Enter both bounds for “between”.";
      if (d.operator === "in" || d.operator === "not_in") return splitList(d.value ?? "").length ? null : "Enter at least one value (comma-separated).";
      return (d.value ?? "").trim() ? null : "Enter a value to compare with.";
    case "normalize_categories":
      if (!d.column) return "Choose a column to tidy.";
      return parseMapping(d.mapping ?? "") ? null : "Each replacement must look like  old => new.";
    case "handle_outliers": {
      if (!d.column) return "Choose a numeric column.";
      const t = Number(d.threshold);
      return Number.isFinite(t) && t > 0 ? null : "The threshold must be a number above 0.";
    }
    case "select_columns": return d.columns?.length ? null : "Choose at least one column to keep.";
    case "drop_columns": return d.columns?.length ? null : "Choose at least one column to remove.";
    default: return null;
  }
}

/** The exact operation object the API expects (see backend/app/datasets/transform.py). */
export function toPayload(d: OpDraft): Record<string, unknown> {
  switch (d.op) {
    case "drop_duplicates": return { op: d.op, keep: d.keep ?? "first", ...(d.columns?.length ? { subset: d.columns } : {}) };
    case "drop_missing": return { op: d.op, how: d.how ?? "any", ...(d.columns?.length ? { columns: d.columns } : {}) };
    case "fill_missing": return { op: d.op, column: d.column, strategy: d.strategy, ...(d.strategy === "constant" ? { value: (d.value ?? "").trim() } : {}) };
    case "rename_column": return { op: d.op, column: d.column, new_name: (d.newName ?? "").trim() };
    case "cast_type": return { op: d.op, column: d.column, to: d.to, errors: d.errors ?? "coerce", ...(d.to === "datetime" ? { dayfirst: !!d.dayfirst, ...((d.format ?? "").trim() ? { format: d.format!.trim() } : {}) } : {}) };
    case "filter_rows": {
      const base = { op: d.op, column: d.column, operator: d.operator };
      if (needsNoValue(d.operator)) return base;
      if (d.operator === "between") return { ...base, value: [(d.value ?? "").trim(), (d.value2 ?? "").trim()] };
      if (d.operator === "in" || d.operator === "not_in") return { ...base, value: splitList(d.value ?? "") };
      return { ...base, value: (d.value ?? "").trim() };
    }
    case "normalize_categories": {
      const mapping = parseMapping(d.mapping ?? "");
      return { op: d.op, column: d.column, strip: d.strip ?? true, collapse_whitespace: d.collapse ?? true, case: d.caseMode ?? "none", ...(mapping && Object.keys(mapping).length ? { mapping } : {}) };
    }
    case "handle_outliers": return { op: d.op, column: d.column, method: d.method ?? "iqr", threshold: Number(d.threshold), action: d.action ?? "set_missing" };
    case "select_columns": case "drop_columns": return { op: d.op, columns: d.columns ?? [] };
  }
}

const CAST_SEMANTIC: Record<CastTo, string> = { numeric: "numeric_continuous", integer: "numeric_discrete", text: "text", datetime: "datetime", boolean: "boolean" };

/** Column names/types available after applying drafts in order (schema bookkeeping only; no data is touched). */
export function columnsAfter(cols: ColInfo[], drafts: OpDraft[]): ColInfo[] {
  let cur = cols;
  for (const d of drafts) {
    if (d.op === "rename_column" && d.column && (d.newName ?? "").trim()) cur = cur.map((c) => (c.name === d.column ? { ...c, name: d.newName!.trim() } : c));
    else if (d.op === "drop_columns") cur = cur.filter((c) => !d.columns?.includes(c.name));
    else if (d.op === "select_columns" && d.columns?.length) cur = cur.filter((c) => d.columns!.includes(c.name));
    else if (d.op === "cast_type" && d.column && d.to) cur = cur.map((c) => (c.name === d.column ? { ...c, semantic_type: CAST_SEMANTIC[d.to!] } : c));
  }
  return cur;
}

export const toColInfo = (cols: Column[]): ColInfo[] => cols.map((c) => ({ name: c.name, semantic_type: c.semantic_type }));

export function describeDraft(d: OpDraft): string {
  const m = OP_META[d.op].label;
  const col = d.column ? ` · ${d.column}` : d.columns?.length ? ` · ${d.columns.join(", ")}` : "";
  return `${m}${col}`;
}

/** A pre-filled operation for a data-quality issue (the user still reviews it in the builder). */
export function fixForIssue(issue: QualityIssue, cols: ColInfo[]): OpDraft | null {
  const col = issue.column ? cols.find((c) => c.name === issue.column) : undefined;
  switch (issue.code) {
    case "DUPLICATE_ROWS": return defaultDraft("drop_duplicates", cols);
    case "HIGH_MISSING": case "SOME_MISSING":
      return col ? defaultDraft("fill_missing", cols, { column: col.name, strategy: isNumeric(col.semantic_type) ? "median" : "mode" }) : null;
    case "OUTLIERS": return col ? defaultDraft("handle_outliers", cols, { column: col.name }) : null;
    case "CONSTANT_COLUMN": return col ? defaultDraft("drop_columns", cols, { columns: [col.name] }) : null;
    default: return null;
  }
}

export const FIX_LABEL: Record<string, string> = {
  DUPLICATE_ROWS: "Remove duplicates", HIGH_MISSING: "Fill missing values", SOME_MISSING: "Fill missing values", OUTLIERS: "Handle outliers", CONSTANT_COLUMN: "Remove column",
};

export const versionName = (v: Pick<DatasetVersion, "version_number" | "label" | "kind">) => `v${v.version_number} · ${v.label || (v.kind === "original" ? "Original upload" : v.kind)}`;
