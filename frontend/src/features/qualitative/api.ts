/** Qualitative workspace: query keys, response shapes and hooks. Every number shown comes from these endpoints. */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { del, get, patch, post } from "@/api/client";
import { qk } from "@/api/hooks";
import type { Code, Job, Theme } from "@/api/types";
import { errorMessage } from "@/components/common/blocks";

/** All qualitative queries live under this prefix so one invalidation refreshes the workspace. */
export const qualKey = (pid: string) => ["project", pid, "qualitative"] as const;

export interface TextSource { column: string; avg_words: number | null; non_empty: number | null; segments: number; theme_runs: number }
export interface ThemeRun { id: string; created_at: string; k: number | null; silhouette: number | null; embedding_model: string | null; unassigned: number | null; params: Record<string, unknown> }
export interface ThemesResponse { themes: Theme[]; runs: ThemeRun[] }
export interface QAnnotation { id: string; segment_id: string; code_id: string; source: string; status: string; score: number | null }
export interface QSegment { id: string; row_index: number; seg_index: number; text: string; themes: { id: string; name: string }[]; annotations: QAnnotation[] }
export interface SegmentPage { items: QSegment[]; total: number; page: number; page_size: number }
export interface SearchHit { segment_id: string; row_index: number; text: string; similarity: number }
export interface SearchResponse { query: string; embedding_model: string | null; results: SearchHit[] }
export interface KeywordTerm { term: string; responses: number; occurrences?: number; pct: number }
export interface KeywordsResponse { segments: number; terms: KeywordTerm[] }
export interface KeywordCountResponse { segments: number; terms: { term: string; responses: number; pct: number }[] }
export interface ThemeSummary { text?: string; origin?: string; model?: string | null; quotes?: string[]; validation?: { status: string; problems: string[] }; fallback_reason?: string | null }

export interface SegmentFilters { themeId?: string; codeId?: string; q?: string; unthemed?: boolean; review?: boolean; page: number }

export const PAGE_SIZE = 30;

export function useSources(pid: string, versionId?: string) {
  return useQuery({
    queryKey: [...qualKey(pid), "sources", versionId], enabled: !!versionId,
    queryFn: () => get<TextSource[]>(`/projects/${pid}/qualitative/sources`, { dataset_version_id: versionId }),
  });
}

export function useThemes(pid: string, versionId: string | undefined, column: string | undefined, runId?: string) {
  return useQuery({
    queryKey: [...qualKey(pid), "themes", versionId, column, runId ?? "latest"], enabled: !!versionId && !!column,
    queryFn: () => get<ThemesResponse>(`/projects/${pid}/qualitative/themes`, { dataset_version_id: versionId, column, run_id: runId }),
  });
}

export function useCodes(pid: string) {
  return useQuery({ queryKey: qk.codes(pid), queryFn: () => get<Code[]>(`/projects/${pid}/codes`) });
}

export function useSegments(pid: string, versionId: string | undefined, column: string | undefined, f: SegmentFilters) {
  return useQuery({
    queryKey: [...qualKey(pid), "segments", versionId, column, f], enabled: !!versionId && !!column,
    placeholderData: keepPreviousData,
    queryFn: () => get<SegmentPage>(`/projects/${pid}/qualitative/segments`, {
      dataset_version_id: versionId, column, theme_id: f.themeId, code_id: f.codeId, q: f.q || undefined,
      unthemed: f.unthemed ? "true" : undefined, review: f.review ? "true" : undefined, page: f.page, page_size: PAGE_SIZE,
    }),
  });
}

/** Number of responses that still carry a pending suggestion (page size 1: only `total` is used). */
export function useReviewCount(pid: string, versionId: string | undefined, column: string | undefined) {
  return useQuery({
    queryKey: [...qualKey(pid), "review-count", versionId, column], enabled: !!versionId && !!column,
    queryFn: () => get<SegmentPage>(`/projects/${pid}/qualitative/segments`, { dataset_version_id: versionId, column, review: "true", page: 1, page_size: 1 }),
    select: (d) => d.total,
  });
}

export function useSemanticSearch(pid: string, versionId: string | undefined, column: string | undefined, q: string) {
  return useQuery({
    queryKey: [...qualKey(pid), "search", versionId, column, q], enabled: !!versionId && !!column && q.trim().length >= 2,
    retry: false,
    queryFn: () => get<SearchResponse>(`/projects/${pid}/qualitative/search`, { dataset_version_id: versionId, column, q: q.trim(), limit: 8 }),
  });
}

export function useKeywords(pid: string, versionId: string | undefined, column: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: [...qualKey(pid), "keywords", versionId, column], enabled: enabled && !!versionId && !!column,
    queryFn: () => get<KeywordsResponse>(`/projects/${pid}/qualitative/keywords`, { dataset_version_id: versionId, column, limit: 20 }),
  });
}

export function useKeywordCount(pid: string, versionId: string | undefined, column: string | undefined, terms: string) {
  return useQuery({
    queryKey: [...qualKey(pid), "keyword-count", versionId, column, terms], enabled: !!versionId && !!column && terms.trim().length > 0,
    retry: false,
    queryFn: () => get<KeywordCountResponse>(`/projects/${pid}/qualitative/keyword-count`, { dataset_version_id: versionId, column, terms }),
  });
}

/** Mutation that refreshes the whole workspace (responses, themes, code counts) and reports failures. */
export function useWorkspaceMutation<V, R = unknown>(pid: string, fn: (v: V) => Promise<R>, opts: { onSuccess?: (r: R, v: V) => void; quiet?: boolean } = {}) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r, v) => {
      qc.invalidateQueries({ queryKey: qualKey(pid) });
      qc.invalidateQueries({ queryKey: qk.codes(pid) });
      opts.onSuccess?.(r, v);
    },
    onError: (e) => { if (!opts.quiet) toast.error(errorMessage(e)); },
  });
}

export const api = {
  prepare: (pid: string, b: { dataset_version_id: string; column: string }) => post<Job>(`/projects/${pid}/qualitative/prepare`, b),
  detect: (pid: string, b: { dataset_version_id: string; column: string; n_themes?: number }) => post<Job>(`/projects/${pid}/qualitative/themes/detect`, b),
  suggest: (pid: string, b: { dataset_version_id: string; column: string; use_semantic: boolean; semantic_threshold: number }) => post<Job>(`/projects/${pid}/qualitative/suggest-codes`, b),
  createCode: (pid: string, b: CodeBody) => post<Code>(`/projects/${pid}/codes`, b),
  updateCode: (id: string, b: CodeBody) => patch<Code>(`/codes/${id}`, b),
  deleteCode: (id: string) => del(`/codes/${id}`),
  annotate: (segmentId: string, codeId: string) => post<QAnnotation>(`/segments/${segmentId}/annotations`, { code_id: codeId }),
  unannotate: (segmentId: string, codeId: string) => del(`/segments/${segmentId}/annotations/${codeId}`),
  review: (pid: string, annotation_ids: string[], status: "accepted" | "rejected") => post<{ updated: number }>(`/projects/${pid}/qualitative/annotations/review`, { annotation_ids, status }),
  createTheme: (pid: string, b: { dataset_version_id: string; column: string; name: string; description: string }) => post<Theme>(`/projects/${pid}/qualitative/themes`, b),
  updateTheme: (id: string, b: { name?: string; description?: string }) => patch<Theme>(`/themes/${id}`, b),
  deleteTheme: (id: string) => del(`/themes/${id}`),
  mergeThemes: (pid: string, b: { theme_ids: string[]; name?: string }) => post<Theme>(`/projects/${pid}/qualitative/themes/merge`, b),
  addToTheme: (themeId: string, segmentId: string) => post<void>(`/themes/${themeId}/segments`, { segment_id: segmentId }),
  removeFromTheme: (themeId: string, segmentId: string) => del(`/themes/${themeId}/segments/${segmentId}`),
  summarize: (themeId: string) => post<ThemeSummary>(`/themes/${themeId}/summarize`),
};

export interface CodeBody { name: string; description: string; color: string; category: string; keywords: string[] }
