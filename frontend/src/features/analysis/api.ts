import { keepPreviousData, useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { del, get, patch, post } from "@/api/client";
import { qk, TERMINAL, useDatasets } from "@/api/hooks";
import type { AnalysisDetail, AnalysisSummary, DatasetVersion, Interpretation, Job, Suggestion } from "@/api/types";

export interface Page<T> { items: T[]; total: number; page: number; page_size: number }
export interface AnalysisFilters { analysis_type?: string; dataset_version_id?: string; saved?: boolean; status?: string; page: number; page_size: number }
export interface AnalysisCreated { analysis: AnalysisDetail; job: Job | null; reused: boolean }
export interface RunRequest { dataset_version_id: string; analysis_type: string; config: Record<string, unknown>; title?: string }

export const useAnalysisList = (pid: string, filters: AnalysisFilters) =>
  useQuery({ queryKey: qk.analyses(pid, filters), queryFn: () => get<Page<AnalysisSummary>>(`/projects/${pid}/analyses`, { ...filters }), placeholderData: keepPreviousData });

/** One stored analysis; polls while it is still being computed. */
export const useAnalysis = (id: string, enabled = true) =>
  useQuery({
    queryKey: qk.analysis(id), queryFn: () => get<AnalysisDetail>(`/analyses/${id}`), enabled: enabled && !!id,
    refetchInterval: (q) => (q.state.data && !TERMINAL.has(q.state.data.status) ? 1000 : false),
  });

export const useSuggestions = (datasetId?: string, versionId?: string) =>
  useQuery({ queryKey: qk.suggestions(datasetId ?? "", versionId), queryFn: () => get<Suggestion[]>(`/datasets/${datasetId}/suggestions`, { version_id: versionId }), enabled: !!datasetId && !!versionId, staleTime: 60_000 });

export function useUpdateAnalysis(pid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; title?: string; saved?: boolean }) => patch<AnalysisDetail>(`/analyses/${id}`, body),
    onSuccess: (a) => {
      qc.setQueryData(qk.analysis(a.id), a);
      qc.invalidateQueries({ queryKey: ["project", pid, "analyses"] });
    },
  });
}

export function useDeleteAnalysis(pid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => del(`/analyses/${id}`),
    onSuccess: (_d, id) => {
      qc.removeQueries({ queryKey: qk.analysis(id) });
      qc.invalidateQueries({ queryKey: ["project", pid] });
    },
  });
}

export const useRunAnalysis = (pid: string) => useMutation({ mutationFn: (b: RunRequest) => post<AnalysisCreated>(`/projects/${pid}/analyses`, b) });

export function useExplainAnalysis(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => post<Interpretation>(`/analyses/${id}/explain`, {}),
    onSuccess: (interpretation) => {
      qc.setQueryData<AnalysisDetail>(qk.analysis(id), (a) => (a ? { ...a, interpretation: interpretation as unknown as AnalysisDetail["interpretation"] } : a));
    },
  });
}

/** version id → "Dataset · v2" for every dataset in the project (used to label history rows and filters). */
export function useVersionNames(pid: string) {
  const { data: datasets = [] } = useDatasets(pid);
  const results = useQueries({ queries: datasets.map((d) => ({ queryKey: qk.versions(d.id), queryFn: () => get<DatasetVersion[]>(`/datasets/${d.id}/versions`), staleTime: 60_000 })) });
  const names = new Map<string, { dataset: string; datasetId: string; label: string; number: number }>();
  datasets.forEach((d, i) => {
    for (const v of results[i]?.data ?? []) names.set(v.id, { dataset: d.name, datasetId: d.id, label: v.label, number: v.version_number });
    if (d.latest_version && !names.has(d.latest_version.id)) names.set(d.latest_version.id, { dataset: d.name, datasetId: d.id, label: d.latest_version.label, number: d.latest_version.version_number });
  });
  return names;
}
