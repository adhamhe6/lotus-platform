/** Shared query keys + hooks used across features. Feature-specific hooks live in each feature folder. */
import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { del, get, patch, post } from "./client";
import type { AnalysisType, Dataset, DatasetVersion, Job, Notification, Profile, Project, Member } from "./types";

export const qk = {
  projects: ["projects"] as const,
  project: (id: string) => ["project", id] as const,
  members: (id: string) => ["project", id, "members"] as const,
  overview: (id: string) => ["project", id, "overview"] as const,
  datasets: (pid: string) => ["project", pid, "datasets"] as const,
  versions: (did: string) => ["dataset", did, "versions"] as const,
  profile: (did: string, vid?: string) => ["dataset", did, "profile", vid ?? "latest"] as const,
  preview: (did: string, params: unknown) => ["dataset", did, "preview", params] as const,
  analyses: (pid: string, params?: unknown) => ["project", pid, "analyses", params ?? {}] as const,
  analysis: (id: string) => ["analysis", id] as const,
  analysisTypes: ["analysis-types"] as const,
  insights: (pid: string) => ["project", pid, "insights"] as const,
  jobs: (pid: string) => ["project", pid, "jobs"] as const,
  job: (id: string) => ["job", id] as const,
  notifications: ["notifications"] as const,
  unread: ["notifications", "unread"] as const,
  visualizations: (pid: string) => ["project", pid, "visualizations"] as const,
  reports: (pid: string) => ["project", pid, "reports"] as const,
  codes: (pid: string) => ["project", pid, "codes"] as const,
  themes: (pid: string, vid?: string, col?: string, run?: string) => ["project", pid, "themes", vid, col, run] as const,
  mixed: (pid: string) => ["project", pid, "mixed"] as const,
  conversations: (pid: string) => ["project", pid, "conversations"] as const,
  conversation: (id: string) => ["conversation", id] as const,
  suggestions: (did: string, vid?: string) => ["dataset", did, "suggestions", vid] as const,
};

export const useProjects = () => useQuery({ queryKey: qk.projects, queryFn: () => get<Project[]>("/projects") });
export const useProject = (id: string) => useQuery({ queryKey: qk.project(id), queryFn: () => get<Project>(`/projects/${id}`) });
export const useMembers = (id: string) => useQuery({ queryKey: qk.members(id), queryFn: () => get<Member[]>(`/projects/${id}/members`) });
export const useDatasets = (pid: string) =>
  useQuery({
    queryKey: qk.datasets(pid), queryFn: () => get<Dataset[]>(`/projects/${pid}/datasets`),
    refetchInterval: (q) => (q.state.data?.some((d) => d.status === "PROCESSING") ? 1500 : false),
  });
export const useVersions = (did?: string) => useQuery({ queryKey: qk.versions(did ?? ""), queryFn: () => get<DatasetVersion[]>(`/datasets/${did}/versions`), enabled: !!did });
export const useProfile = (did?: string, vid?: string) =>
  useQuery({ queryKey: qk.profile(did ?? "", vid), queryFn: () => get<Profile>(`/datasets/${did}/profile`, { version_id: vid }), enabled: !!did && !!vid, staleTime: 60_000 });
export const useAnalysisTypes = () => useQuery({ queryKey: qk.analysisTypes, queryFn: () => get<AnalysisType[]>("/analysis-types"), staleTime: Infinity });
export const usePreview = (did: string | undefined, params: Record<string, unknown>) =>
  useQuery({ queryKey: qk.preview(did ?? "", params), queryFn: () => get(`/datasets/${did}/preview`, params) as Promise<import("./types").Preview>, enabled: !!did, placeholderData: keepPreviousData });

export const TERMINAL = new Set(["COMPLETED", "FAILED", "CANCELLED"]);
export const useJobQuery = (id?: string | null) =>
  useQuery({
    queryKey: qk.job(id ?? ""), queryFn: () => get<Job>(`/jobs/${id}`), enabled: !!id,
    refetchInterval: (q) => (q.state.data && TERMINAL.has(q.state.data.status) ? false : 700),
  });

export const useNotifications = () => useQuery({ queryKey: qk.notifications, queryFn: () => get<Notification[]>("/notifications"), refetchInterval: 20_000 });
export const useUnreadCount = () => useQuery({ queryKey: qk.unread, queryFn: () => get<{ count: number }>("/notifications/unread-count"), refetchInterval: 20_000 });

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { name: string; description: string; objective: string }) => post<Project>("/projects", b),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.projects }),
  });
}
export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => del(`/projects/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: qk.projects }) });
}
export function useUpdateProject(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: Partial<{ name: string; description: string; objective: string }>) => patch<Project>(`/projects/${id}`, b),
    onSuccess: () => { qc.invalidateQueries({ queryKey: qk.project(id) }); qc.invalidateQueries({ queryKey: qk.projects }); qc.invalidateQueries({ queryKey: qk.overview(id) }); },
  });
}

/** Invalidate everything that depends on project content (used after jobs finish). */
export function projectContentKeys(pid: string): QueryKey[] {
  return [["project", pid], ["dataset"], ["analysis"], qk.projects];
}
