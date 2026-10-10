import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { del, get, patch, post } from "@/api/client";
import { qk } from "@/api/hooks";
import type { ChartSpec, Member, Role } from "@/api/types";

export interface OvDataset {
  id: string; name: string; status: string; error: unknown; latest_version_id: string | null; version_count: number;
  rows: number | null; columns: number | null; missing_pct: number | null; duplicate_rows: number | null; warnings: number; created_at: string;
}
export interface OvEvidence { label: string; value: unknown; unit?: string | null; table?: string | null; metric?: string | null }
export interface Overview {
  project: { id: string; name: string; description: string; objective: string; created_at: string };
  counts: { datasets: number; analyses: number; insights: number; themes: number; reports: number; mixed: number; codes: number };
  datasets: OvDataset[];
  recent_analyses: { id: string; title: string; analysis_type: string; status: string; created_at: string; headline: { label: string; value: unknown } | null }[];
  key_insights: { id: string; title: string; statement: string; qualification: string; kind: string; pinned: boolean; evidence: OvEvidence[] }[];
  themes: { id: string; name: string; column_name: string; response_count: number; share_pct: number }[];
  reports: { id: string; title: string; status: string; created_at: string }[];
  visualizations: { id: string; name: string; spec: ChartSpec }[];
  jobs: { id: string; type: string; status: string; stage: string | null; progress: number; created_at: string }[];
  activity: { kind: string; title: string; id: string; at: string; status?: string }[];
  role: Role;
  cached?: boolean;
}

const ACTIVE = new Set(["PENDING", "RUNNING"]);
export const useOverview = (pid: string) =>
  useQuery({
    queryKey: qk.overview(pid), queryFn: () => get<Overview>(`/projects/${pid}/overview`),
    refetchInterval: (q) => (q.state.data?.jobs.some((j) => ACTIVE.has(j.status)) ? 3000 : false),
  });

export function useAddMember(pid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { email: string; role: "EDITOR" | "VIEWER" }) => post<Member>(`/projects/${pid}/members`, b),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.members(pid) }),
  });
}
export function useChangeMemberRole(pid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { userId: string; role: "EDITOR" | "VIEWER" }) => patch<void>(`/projects/${pid}/members/${b.userId}`, { role: b.role }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.members(pid) }),
  });
}
export function useRemoveMember(pid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => del(`/projects/${pid}/members/${userId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.members(pid) }),
  });
}
