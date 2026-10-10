/** The chart builder's request model. Mirrors backend/app/visualization/builder.py `ChartRequest`; only the fields a chart kind uses are sent. */
export type ChartKindId = "histogram" | "bar" | "box" | "scatter" | "line" | "heatmap" | "stacked_bar" | "donut";
export type Aggregation = "count" | "mean" | "sum" | "median";
export type Frequency = "D" | "W" | "M" | "Q" | "Y";
export type Role = "numeric" | "group" | "date";

export interface ChartState {
  kind: ChartKindId; x?: string; y?: string; group?: string; columns: string[];
  aggregation: Aggregation; frequency: Frequency; top_n: number; trendline: boolean;
}
export interface ChartSuggestion { kind: ChartKindId; x?: string; y?: string; group?: string; columns?: string[]; aggregation?: Aggregation; reason: string }

export const KINDS: { kind: ChartKindId; label: string; help: string }[] = [
  { kind: "histogram", label: "Histogram", help: "Distribution of one numeric variable" },
  { kind: "bar", label: "Bar", help: "Counts or averages per category" },
  { kind: "box", label: "Box plot", help: "Spread of a number, optionally by group" },
  { kind: "scatter", label: "Scatter", help: "Relationship between two numbers" },
  { kind: "line", label: "Line", help: "A number or count over time" },
  { kind: "heatmap", label: "Heatmap", help: "Correlations across several numbers" },
  { kind: "stacked_bar", label: "Stacked bar", help: "Composition of one category within another" },
  { kind: "donut", label: "Donut", help: "Share of a whole (up to 6 parts)" },
];
export const kindLabel = (k: string) => KINDS.find((x) => x.kind === k)?.label ?? k;

export const AGGREGATIONS: { value: Aggregation; label: string }[] = [
  { value: "count", label: "Count of rows" }, { value: "mean", label: "Average" }, { value: "sum", label: "Sum" }, { value: "median", label: "Median" },
];
export const FREQUENCIES: { value: Frequency; label: string }[] = [
  { value: "D", label: "Day" }, { value: "W", label: "Week" }, { value: "M", label: "Month" }, { value: "Q", label: "Quarter" }, { value: "Y", label: "Year" },
];

export const NEW_STATE: ChartState = { kind: "histogram", columns: [], aggregation: "count", frequency: "M", top_n: 15, trendline: true };

const NUMERIC = new Set(["numeric_continuous", "numeric_discrete", "binary"]);
const GROUPABLE = new Set(["categorical", "boolean", "binary", "numeric_discrete"]);
export const matchesRole = (role: Role, semantic: string) => (role === "numeric" ? NUMERIC.has(semantic) : role === "group" ? GROUPABLE.has(semantic) : semantic === "datetime");

/** Which variable slots a chart kind uses, in display order. */
export interface Slot { field: "x" | "y" | "group"; label: string; role: Role; required: boolean; none?: string }
export function slotsFor(s: ChartState): Slot[] {
  const needsMeasure = s.aggregation !== "count";
  switch (s.kind) {
    case "histogram": return [{ field: "x", label: "Variable", role: "numeric", required: true }];
    case "bar": return [{ field: "x", label: "Category", role: "group", required: true }, ...(needsMeasure ? [{ field: "y" as const, label: "Measure", role: "numeric" as const, required: true }] : [])];
    case "donut": return [{ field: "x", label: "Category", role: "group", required: true }];
    case "box": return [{ field: "y", label: "Variable", role: "numeric", required: true }, { field: "x", label: "Group by (optional)", role: "group", required: false, none: "None, a single box" }];
    case "scatter": return [{ field: "x", label: "X axis", role: "numeric", required: true }, { field: "y", label: "Y axis", role: "numeric", required: true }];
    case "line": return [{ field: "x", label: "Date column", role: "date", required: true }, ...(needsMeasure ? [{ field: "y" as const, label: "Measure", role: "numeric" as const, required: true }] : [])];
    case "stacked_bar": return [{ field: "x", label: "Category", role: "group", required: true }, { field: "group", label: "Stack by", role: "group", required: true }];
    case "heatmap": return [];
  }
}
export const usesAggregation = (k: ChartKindId) => k === "bar" || k === "line";
export const usesTopN = (s: ChartState) => s.kind === "bar" || s.kind === "stacked_bar" || (s.kind === "box" && !!s.x);

export interface Col { name: string; semantic_type: string }

/** Drop selections that no longer fit the chosen kind / aggregation. */
export function sanitize(s: ChartState, cols: Col[]): ChartState {
  const type = (n?: string) => cols.find((c) => c.name === n)?.semantic_type;
  const next: ChartState = { ...s };
  const slots = slotsFor(s);
  for (const f of ["x", "y", "group"] as const) {
    const slot = slots.find((x) => x.field === f);
    const t = type(s[f]);
    if (!slot || !t || !matchesRole(slot.role, t)) next[f] = undefined;
  }
  next.columns = s.columns.filter((n) => { const t = type(n); return !!t && matchesRole("numeric", t); });
  if (!usesAggregation(s.kind)) next.aggregation = "count";
  return next;
}

/** What is still missing before a request can be sent, or null when complete. */
export function missingInput(s: ChartState): string | null {
  if (s.kind === "heatmap") return s.columns.length >= 2 ? null : "Choose at least two numeric variables.";
  const lack = slotsFor(s).find((slot) => slot.required && !s[slot.field]);
  if (lack) return `Choose a ${lack.label.toLowerCase()} to preview the chart.`;
  if (s.kind === "stacked_bar" && s.x === s.group) return "Choose two different categories.";
  return null;
}

/** The exact body for the preview/save endpoints (without `dataset_version_id`). */
export function buildRequest(s: ChartState): Record<string, unknown> {
  const r: Record<string, unknown> = { kind: s.kind };
  switch (s.kind) {
    case "histogram": case "donut": r.x = s.x; break;
    case "bar": r.x = s.x; r.aggregation = s.aggregation; if (s.aggregation !== "count") r.y = s.y; r.top_n = s.top_n; break;
    case "box": r.y = s.y; if (s.x) { r.x = s.x; r.top_n = s.top_n; } break;
    case "scatter": r.x = s.x; r.y = s.y; r.trendline = s.trendline; break;
    case "line": r.x = s.x; r.aggregation = s.aggregation; if (s.aggregation !== "count") r.y = s.y; r.frequency = s.frequency; break;
    case "heatmap": r.columns = s.columns; break;
    case "stacked_bar": r.x = s.x; r.group = s.group; r.top_n = s.top_n; break;
  }
  return r;
}

export function fromRequest(req: Record<string, unknown>): ChartState {
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  return {
    ...NEW_STATE, kind: (str(req.kind) as ChartKindId) ?? "histogram", x: str(req.x), y: str(req.y), group: str(req.group),
    columns: Array.isArray(req.columns) ? req.columns.filter((c): c is string => typeof c === "string") : [],
    aggregation: (str(req.aggregation) as Aggregation) ?? "count", frequency: (str(req.frequency) as Frequency) ?? "M",
    top_n: typeof req.top_n === "number" ? req.top_n : NEW_STATE.top_n, trendline: req.trendline !== false,
  };
}
export const fromSuggestion = (s: ChartSuggestion): ChartState => fromRequest({ ...s, columns: s.columns ?? [] });

export function suggestionTitle(s: ChartSuggestion): string {
  switch (s.kind) {
    case "histogram": return `Histogram of ${s.x}`;
    case "scatter": return `${s.y} vs ${s.x}`;
    case "bar": return s.aggregation && s.aggregation !== "count" && s.y ? `${s.y} by ${s.x}` : `Count by ${s.x}`;
    case "box": return s.x ? `${s.y} by ${s.x}` : `Spread of ${s.y}`;
    case "line": return `${s.y ?? "Count"} over ${s.x}`;
    case "heatmap": return "Correlation heatmap";
    default: return kindLabel(s.kind);
  }
}
