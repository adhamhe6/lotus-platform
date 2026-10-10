import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, del, get, post, put } from "@/api/client";
import { qk, useDatasets } from "@/api/hooks";
import type { AnalysisSummary, Insight, Job, MixedRun, Visualization } from "@/api/types";
import type { DatasetVersion } from "@/api/types";

export interface Section { id: string; type: string; title: string; body?: string; ref?: Record<string, unknown>; meta?: Record<string, unknown>; evidence?: unknown[] }
export type ReportStatus = "DRAFT" | "READY";
export interface Report {
  id: string; project_id: string; title: string; objective: string; sections: Section[]; sources: Partial<Record<SourceKey, string[]>>;
  status: ReportStatus; generation: Record<string, unknown>; created_at: string; updated_at: string | null;
}
export type SourceKey = "analysis_runs" | "dataset_versions" | "mixed_runs" | "insights" | "visualizations" | "theme_runs";
export type ReportDraft = Pick<Report, "title" | "objective" | "sections" | "status">;

export const reportKey = (pid: string, id: string) => ["project", pid, "report", id] as const;

export const useReports = (pid: string) => useQuery({ queryKey: qk.reports(pid), queryFn: () => get<Report[]>(`/projects/${pid}/reports`) });
export const useReport = (pid: string, id: string) => useQuery({ queryKey: reportKey(pid, id), queryFn: () => get<Report>(`/reports/${id}`) });

export function useCreateReport(pid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { title: string; objective?: string; sections?: Section[] }) => post<Report>(`/projects/${pid}/reports`, b),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.reports(pid) }),
  });
}
export function useDeleteReport(pid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => del(`/reports/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: qk.reports(pid) }); qc.invalidateQueries({ queryKey: qk.overview(pid) }); },
  });
}
export const generateReport = (pid: string, b: { title: string; dataset_version_id?: string; with_ai: boolean }) => post<Job>(`/projects/${pid}/reports/generate`, b);
export function useSaveReport(pid: string, id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: ReportDraft) => put<Report>(`/reports/${id}`, b),
    onSuccess: (r) => {
      qc.setQueryData(reportKey(pid, id), r);
      qc.invalidateQueries({ queryKey: qk.reports(pid) });
      qc.invalidateQueries({ queryKey: qk.overview(pid) });
    },
  });
}
export const fetchRender = (id: string, format: "html" | "markdown" | "json") => api<string>(`/reports/${id}/render`, { params: { format }, raw: true });

// ── project resources the sections can point at ──────────────────────────────────────────
export const useAnalysesForReport = (pid: string) =>
  useQuery({ queryKey: qk.analyses(pid, { for: "report" }), queryFn: () => get<{ items: AnalysisSummary[] }>(`/projects/${pid}/analyses`, { page_size: 100, status: "COMPLETED" }).then((p) => p.items) });
export const useInsightsList = (pid: string) => useQuery({ queryKey: qk.insights(pid), queryFn: () => get<Insight[]>(`/projects/${pid}/insights`) });
export const useVisualizationsList = (pid: string) => useQuery({ queryKey: qk.visualizations(pid), queryFn: () => get<Visualization[]>(`/projects/${pid}/visualizations`) });
export const useMixedRuns = (pid: string) => useQuery({ queryKey: qk.mixed(pid), queryFn: () => get<MixedRun[]>(`/projects/${pid}/mixed`) });
export interface ThemeRun { id: string; created_at: string; k: number | null; params: { column?: string } & Record<string, unknown> }
export const useThemeRuns = (pid: string, versionId?: string) =>
  useQuery({ queryKey: ["project", pid, "report-theme-runs", versionId], queryFn: () => get<{ runs: ThemeRun[] }>(`/projects/${pid}/qualitative/themes`, { dataset_version_id: versionId }).then((r) => r.runs), enabled: !!versionId });

export interface VersionInfo { id: string; datasetId: string; datasetName: string; number: number; label: string }
/** Every dataset version in the project, so ids in `sources` can be shown by name and linked to their dataset. */
export function useVersionIndex(pid: string) {
  const datasets = useDatasets(pid);
  const list = datasets.data ?? [];
  const results = useQueries({ queries: list.map((d) => ({ queryKey: qk.versions(d.id), queryFn: () => get<DatasetVersion[]>(`/datasets/${d.id}/versions`) })) });
  const versions: VersionInfo[] = [];
  list.forEach((d, i) => (results[i]?.data ?? []).forEach((v) => versions.push({ id: v.id, datasetId: d.id, datasetName: d.name, number: v.version_number, label: v.label })));
  return { versions, datasets: list, loading: datasets.isLoading || results.some((r) => r.isLoading) };
}
