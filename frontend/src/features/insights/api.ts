import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { del, get, post } from "@/api/client";
import { qk } from "@/api/hooks";
import type { Insight, Interpretation, Job } from "@/api/types";

export interface InsightFilters { kind?: string; pinned?: boolean; analysis_run_id?: string; limit?: number }

export const useInsights = (pid: string, filters: InsightFilters = {}, enabled = true) =>
  useQuery({ queryKey: [...qk.insights(pid), filters], queryFn: () => get<Insight[]>(`/projects/${pid}/insights`, { limit: 100, ...filters }), enabled, placeholderData: keepPreviousData });

export function usePinInsight(pid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, pinned }: { id: string; pinned: boolean }) => post<Insight>(`/insights/${id}/pin?pinned=${pinned}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.insights(pid) }),
  });
}

export function useNarrateInsight(pid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => post<Insight>(`/insights/${id}/narrative`),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.insights(pid) }),
  });
}

export function useDeleteInsight(pid: string) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => del(`/insights/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ["project", pid] }) });
}

export const useGenerateInsights = (pid: string) =>
  useMutation({ mutationFn: () => post<Job>(`/projects/${pid}/insights/generate`, { with_narratives: false }) });

export const asInterpretation = (narrative: Insight["narrative"]) => (narrative ? (narrative as unknown as Interpretation) : null);
