import type { AnalysisSummary, Insight, MixedRun, Visualization } from "@/api/types";
import { titleCase } from "@/lib/format";

const sentence = (t: string) => { const s = t.replace(/_/g, " "); return s.charAt(0).toUpperCase() + s.slice(1); };
import type { Section, VersionInfo } from "./reportsApi";

export interface SectionKind { type: string; label: string; addable: boolean; needsRef: boolean; hint: string }
/** The section types the server accepts (`SECTION_TYPES` in backend/app/services/reports.py). `ai_summary` only comes from generated drafts. */
export const SECTION_KINDS: SectionKind[] = [
  { type: "text", label: "Text", addable: true, needsRef: false, hint: "Your own words" },
  { type: "findings", label: "Key findings", addable: true, needsRef: true, hint: "Pick insights to include" },
  { type: "analysis", label: "Analysis", addable: true, needsRef: true, hint: "A completed analysis with its charts and tables" },
  { type: "visualization", label: "Visualization", addable: true, needsRef: true, hint: "A saved chart" },
  { type: "themes", label: "Themes", addable: true, needsRef: true, hint: "Themes detected in a text column" },
  { type: "mixed", label: "Mixed methods", addable: true, needsRef: true, hint: "Themes joined to a numeric outcome" },
  { type: "dataset", label: "Dataset", addable: true, needsRef: true, hint: "Size and quality of a dataset version" },
  { type: "methodology", label: "Methodology", addable: true, needsRef: false, hint: "Composed from the analyses included" },
  { type: "limitations", label: "Limitations", addable: true, needsRef: false, hint: "Composed from data-quality notes" },
  { type: "traceability", label: "Traceability", addable: true, needsRef: false, hint: "Every source this report draws on" },
  { type: "ai_summary", label: "AI-assisted summary", addable: false, needsRef: false, hint: "" },
];
export const kindLabel = (type: string) => SECTION_KINDS.find((k) => k.type === type)?.label ?? titleCase(type);

export const newSectionId = () => (globalThis.crypto?.randomUUID?.().replace(/-/g, "").slice(0, 12) ?? Math.random().toString(16).slice(2, 14).padEnd(12, "0"));
export const makeSection = (type: string, title: string, ref?: Record<string, unknown>): Section => ({ id: newSectionId(), type, title, ...(type === "text" ? { body: "" } : {}), ...(ref ? { ref } : {}) });

/** Provenance of what a section embeds. */
export type SectionProvenance = { kind: "computed" | "qualitative" | "ai"; label?: string }[] | "author" | "composed";
export function provenanceOf(type: string): SectionProvenance {
  switch (type) {
    case "analysis": case "findings": case "visualization": case "dataset": return [{ kind: "computed" }];
    case "themes": return [{ kind: "qualitative" }];
    case "mixed": return [{ kind: "computed" }, { kind: "qualitative" }];
    case "ai_summary": return [{ kind: "ai", label: "AI-assisted" }];
    case "text": return "author";
    default: return "composed";
  }
}

export interface Lookups {
  analyses: AnalysisSummary[]; insights: Insight[]; visualizations: Visualization[]; mixed: MixedRun[]; versions: VersionInfo[];
}
const str = (v: unknown) => (typeof v === "string" ? v : "");

/** A short human sentence on what a section embeds, resolved against the project's real resources. */
export function describeSection(s: Section, l: Lookups): string {
  const ref = s.ref ?? {};
  switch (s.type) {
    case "text": return "Free text written by you, included as written.";
    case "ai_summary": return "AI-assisted summary. It is included only because its numbers passed validation against the computed results.";
    case "findings": {
      const ids = (ref.insight_ids as string[] | undefined) ?? [];
      const titles = ids.map((id) => l.insights.find((i) => i.id === id)?.title).filter(Boolean) as string[];
      return `${ids.length} key finding${ids.length === 1 ? "" : "s"}${titles.length ? `: ${titles.slice(0, 2).join("; ")}${titles.length > 2 ? "; …" : ""}` : ""}.`;
    }
    case "analysis": {
      const a = l.analyses.find((x) => x.id === ref.analysis_run_id);
      const parts = [ref.tables !== false && "tables", ref.charts !== false && "charts"].filter(Boolean).join(" and ");
      return a ? `${sentence(a.analysis_type)} analysis “${a.title}”${parts ? `, with its ${parts}` : ""}.` : "A stored analysis (details unavailable).";
    }
    case "visualization": {
      const v = l.visualizations.find((x) => x.id === ref.visualization_id);
      return v ? `Saved chart “${v.name}”.` : "A saved chart (details unavailable).";
    }
    case "themes": return `Themes detected in the “${str(ref.column)}” column${versionName(l, ref.dataset_version_id)}.`;
    case "mixed": {
      const m = l.mixed.find((x) => x.id === ref.mixed_run_id);
      return m ? `Mixed-methods run: ${m.outcome_column} compared across themes in “${m.column_name}”.` : "A mixed-methods run (details unavailable).";
    }
    case "dataset": return `Size and quality summary of ${versionName(l, ref.dataset_version_id, true) || "a dataset version"}.`;
    case "methodology": return "Methodology notes composed by Lotus from the analyses included.";
    case "limitations": return "Limitations composed by Lotus from data-quality checks and analysis warnings.";
    case "traceability": return "A table of every analysis, dataset version and run this report draws on.";
    default: return "";
  }
}
function versionName(l: Lookups, id: unknown, bare = false): string {
  const v = l.versions.find((x) => x.id === id);
  if (!v) return "";
  const n = `${v.datasetName} v${v.number}`;
  return bare ? n : ` (${n})`;
}
