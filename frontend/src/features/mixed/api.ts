/** Mixed-methods: response shapes (mirroring backend/app/mixed/engine.py), hooks and the chart-spec reshaper. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { del, get, post } from "@/api/client";
import { qk } from "@/api/hooks";
import { fmtNumber } from "@/lib/format";
import type { ChartSpec, Code, Interpretation, Job, MixedRun } from "@/api/types";

export interface Comparison {
  column?: string; n_with: number; n_without: number; mean_with: number | null; mean_without: number | null; median_with?: number | null; median_without?: number | null;
  status?: "insufficient_n" | "constant"; test?: string | null; p?: number | null; p_adj?: number | null; diff?: number | null; ci?: [number, number] | null;
  effect?: number | null; effect_ci?: [number, number] | null; effect_kind?: string; significant?: boolean;
}
export interface GroupRate { n: number; voiced: number; pct: number }
export interface ByGroup { column: string; status: "tested" | "insufficient_n"; rates: Record<string, GroupRate>; chi2?: number; dof?: number; p?: number; p_adj?: number; cramers_v?: number; significant?: boolean }
export interface MixedItem { id: string; name: string; kind: "theme" | "code"; n_respondents: number; prevalence_pct: number; quotes: string[]; outcome: Comparison; comparisons: Comparison[]; by_group: ByGroup | null }
export interface Finding { id: string; kind: "outcome_difference" | "convergence" | "group_prevalence"; item: string; column?: string; qualification: "strong" | "moderate" | "tentative"; statement: string; numbers: Record<string, number | string | null> }
export interface MixedResult {
  overall: { respondents: number; respondents_with_outcome: number; outcome: string; outcome_mean: number | null; outcome_median: number | null; tests_run: number; items: number };
  items: MixedItem[]; findings: Finding[]; warnings: string[]; methodology: string; tested_items?: number;
  thresholds: { alpha: number; min_abs_g_outcome: number; min_abs_g_convergence: number; min_group_n: number; correction: string };
}
export type Synthesis = Interpretation;
export interface MixedRunView extends Omit<MixedRun, "result" | "synthesis"> { result: MixedResult; synthesis: Synthesis | null }

export interface TextSource { column: string; segments: number; theme_runs: number }
export interface ThemeRunInfo { id: string; created_at: string; k: number | null }

export interface MixedBody { dataset_version_id: string; text_column: string; outcome: string; source: "themes" | "codes"; group?: string; compare?: string[]; theme_run_id?: string }

export const mixedKey = (pid: string) => qk.mixed(pid);

export function useMixedRuns(pid: string) {
  return useQuery({ queryKey: mixedKey(pid), queryFn: () => get<MixedRunView[]>(`/projects/${pid}/mixed`) });
}
export function useTextSources(pid: string, versionId?: string) {
  return useQuery({ queryKey: ["project", pid, "qualitative", "sources", versionId], enabled: !!versionId, queryFn: () => get<TextSource[]>(`/projects/${pid}/qualitative/sources`, { dataset_version_id: versionId }) });
}
export function useThemeRuns(pid: string, versionId?: string, column?: string) {
  return useQuery({
    queryKey: ["project", pid, "qualitative", "themes", versionId, column, "latest"], enabled: !!versionId && !!column,
    queryFn: () => get<{ themes: { id: string }[]; runs: ThemeRunInfo[] }>(`/projects/${pid}/qualitative/themes`, { dataset_version_id: versionId, column }),
  });
}
export function useCodes(pid: string) {
  return useQuery({ queryKey: qk.codes(pid), queryFn: () => get<Code[]>(`/projects/${pid}/codes`) });
}
export const startMixed = (pid: string, b: MixedBody) => post<Job>(`/projects/${pid}/mixed`, b);

export function useSynthesize(pid: string) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => post<MixedRunView>(`/mixed/${id}/synthesis`), onSuccess: () => qc.invalidateQueries({ queryKey: mixedKey(pid) }) });
}
export function useDeleteRun(pid: string) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => del(`/mixed/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: mixedKey(pid) }) });
}

/** Verbal label for Hedges' g (Cohen's conventional bands; same cut-offs the server uses in its statements). Display only. */
export function magnitude(g: number | null | undefined): string {
  if (g == null) return "—";
  const a = Math.abs(g);
  return a < 0.2 ? "negligible" : a < 0.5 ? "small" : a < 0.8 ? "medium" : "large";
}

/** Reshape server numbers into a chart: one bar per (item, with/without). Values are passed through untouched. */
export function meansChart(result: MixedResult, itemWord: string): ChartSpec | null {
  const rows = result.items.filter((i) => i.outcome.mean_with != null && i.outcome.mean_without != null);
  if (!rows.length) return null;
  const categories = rows.flatMap((i) => [`${i.name} · with`, `${i.name} · without`]);
  const values = rows.flatMap((i) => [i.outcome.mean_with as number, i.outcome.mean_without as number]);
  const counts = rows.flatMap((i) => [i.outcome.n_with, i.outcome.n_without]);
  const o = result.overall.outcome;
  return {
    kind: "hbar", title: `Mean ${o}, with vs without each ${itemWord}`, subtitle: "Respondents whose response carries the item, compared with those whose response does not",
    y_label: `Mean ${o}`, x_label: null,
    data: { categories, series: [{ name: `Mean ${o}`, values }], counts },
    description: `Horizontal bars of the mean ${o} for respondents with and without each ${itemWord}: ${categories.map((c, i) => `${c} ${fmtNumber(values[i], 2)}`).join("; ")}.`,
    notes: ["An association among respondents, not evidence that a topic causes the outcome."],
  };
}
