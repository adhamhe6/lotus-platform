import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { del, get, post } from "@/api/client";
import { qk } from "@/api/hooks";
import type { Conversation, ConversationDetail, Message, Suggestion } from "@/api/types";

// ── typed provenance blocks the API attaches to assistant messages ─────────────────────────
export interface EvidenceItem { id: string; kind: string; label: string; text: string; source: Record<string, unknown> }
export interface ComputedBlock { type: "computed"; title: string; evidence_ids: string[]; analysis_type?: string; analysis_run_id?: string }
export interface QualitativeBlock { type: "qualitative"; title: string; evidence_ids: string[] }
export interface MixedBlock { type: "mixed"; title: string; evidence_ids: string[]; mixed_run_id?: string }
export interface InterpretationBlock {
  type: "interpretation"; origin: "llm" | "rule"; model: string | null; provider?: string | null; summary: string;
  points: { text: string; evidence: string[] }[]; caveats: string[]; next_steps: string[];
  validation?: { status: string; problems: string[] }; fallback_reason?: string | null;
}
export interface NoticeBlock { type: "notice"; text: string }
export type Block = ComputedBlock | QualitativeBlock | MixedBlock | InterpretationBlock | NoticeBlock;
const KNOWN = new Set(["computed", "qualitative", "mixed", "interpretation", "notice"]);
export const blocksOf = (m: Message): Block[] => (m.blocks as { type?: string }[]).filter((b) => b && KNOWN.has(b.type ?? "")) as Block[];
export const evidenceOf = (m: Message) => (m.evidence ?? []) as EvidenceItem[];
export interface MessageMeta { model?: string | null; provider?: string | null; prompt_version?: string | null; origin?: string; fallback_reason?: string | null }
export const metaOf = (m: Message) => (m.meta ?? {}) as MessageMeta;

// ── queries ──────────────────────────────────────────────────────────────────────────────
export const useConversations = (pid: string) => useQuery({ queryKey: qk.conversations(pid), queryFn: () => get<Conversation[]>(`/projects/${pid}/ai/conversations`) });
export const useConversation = (id?: string | null) => useQuery({ queryKey: qk.conversation(id ?? ""), queryFn: () => get<ConversationDetail>(`/ai/conversations/${id}`), enabled: !!id });
export const useSuggestions = (datasetId?: string, versionId?: string) =>
  useQuery({ queryKey: qk.suggestions(datasetId ?? "", versionId), queryFn: () => get<Suggestion[]>(`/datasets/${datasetId}/suggestions`, { version_id: versionId }), enabled: !!datasetId, staleTime: 5 * 60_000 });

export function useCreateConversation(pid: string) {
  return useMutation({ mutationFn: (b: { dataset_version_id?: string | null; title?: string }) => post<Conversation>(`/projects/${pid}/ai/conversations`, b) });
}
export function useDeleteConversation(pid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => del(`/ai/conversations/${id}`),
    onSuccess: (_d, id) => { qc.removeQueries({ queryKey: qk.conversation(id) }); qc.invalidateQueries({ queryKey: qk.conversations(pid) }); },
  });
}
export const askMessage = (conversationId: string, content: string) => post<Message[]>(`/ai/conversations/${conversationId}/messages`, { content });
