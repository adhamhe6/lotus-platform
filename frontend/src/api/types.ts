/** Friendly aliases over the generated OpenAPI types (regenerate with `npm run gen:api`). */
import type { components } from "./schema";

type S = components["schemas"];
export type User = S["UserOut"];
export type Project = S["ProjectOut"];
export type Member = S["MemberOut"];
export type Dataset = S["DatasetOut"];
export type DatasetVersion = S["VersionOut"];
export type Column = S["ColumnOut"];
export type Profile = S["ProfileOut"];
export type Preview = S["PreviewOut"];
export type Job = S["JobOut"];
export type Notification = S["NotificationOut"];
export type AnalysisSummary = S["AnalysisSummary"];
export type AnalysisDetail = S["AnalysisDetail"];
export type Insight = S["InsightOut"];
export type Conversation = S["ConversationOut"];
export type ConversationDetail = S["ConversationDetail"];
export type Message = S["MessageOut"];
export type Code = S["CodeOut"];
export type Theme = S["ThemeOut"];
export type Segment = S["SegmentOut"];
export type Annotation = S["AnnotationOut"];
export type MixedRun = S["MixedRunOut"];
export type Visualization = S["VisualizationOut"];
export type Role = "OWNER" | "EDITOR" | "VIEWER";

// ── engine result shapes (the API types them as free-form JSON) ──────────────────────────
export interface Metric { key: string; label: string; value: number | string | boolean | null; unit?: string | null; ci?: [number, number] | null; note?: string | null; primary?: boolean }
export interface TableColumn { key: string; label: string; kind: "text" | "number" | "percent" | "p_value" | "integer" }
export interface ResultTable { name: string; title: string; columns: TableColumn[]; rows: Record<string, unknown>[]; note?: string | null }
export interface Assumption { name: string; status: "met" | "violated" | "unknown" | "not_applicable"; detail: string; test?: string | null; statistic?: number | null; p_value?: number | null }
export type ChartKind = "bar" | "hbar" | "stacked_bar" | "line" | "scatter" | "histogram" | "box" | "heatmap" | "donut" | "coef" | "roc";
export interface ChartSpec { kind: ChartKind; title: string; subtitle?: string | null; x_label?: string | null; y_label?: string | null; data: Record<string, any>; description: string; notes: string[] } // eslint-disable-line @typescript-eslint/no-explicit-any
export interface AnalysisResult {
  type: string; title: string; variables: Record<string, unknown>; n_total: number; n_used: number;
  metrics: Metric[]; tables: ResultTable[]; charts: ChartSpec[]; assumptions: Assumption[]; warnings: string[]; decisions: string[]; methodology: string;
}
export interface Interpretation {
  summary: string; points: { text: string; evidence: string[] }[]; caveats: string[]; next_steps: string[];
  meta: { origin: "llm" | "rule"; provider: string; model: string | null; prompt_version: string; validation: { status: string; problems: string[] }; fallback_reason?: string | null; generated_at: string };
  evidence: { id: string; kind: string; label: string; text: string; source: Record<string, unknown> }[];
}
export interface AnalysisType {
  type: string; label: string; description: string; category: string;
  roles: { key: string; label: string; accepts: string[]; multiple: boolean; required: boolean; min_count: number; help: string }[];
  parameters: { key: string; label: string; type: "select" | "boolean" | "integer" | "text"; default: unknown; options?: { value: string; label: string }[]; min?: number; max?: number; help?: string }[];
}
export interface Suggestion { title: string; analysis_type: string; config: Record<string, unknown>; reason: string; score: number }
