import { useQueryClient } from "@tanstack/react-query";
import { Database, Loader2, MessageSquarePlus, PanelLeft, SendHorizonal, Sparkles, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ApiError } from "@/api/client";
import { qk, useProject } from "@/api/hooks";
import type { ConversationDetail, Message } from "@/api/types";
import { EmptyState, ErrorState, PageHeader, SkeletonRows, errorMessage } from "@/components/common/blocks";
import { Alert } from "@/components/ui/alert";
import { ConfirmDialog } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { useActiveDataset } from "@/lib/activeDataset";
import { fmtRelative } from "@/lib/format";
import { useProjectId } from "@/lib/useProjectId";
import { cn } from "@/lib/utils";
import { askMessage, useConversation, useConversations, useCreateConversation, useDeleteConversation, useSuggestions } from "./assistantApi";
import { AssistantMessage, UserBubble } from "./MessageView";
import { buildSuggestions } from "./suggestions";

function describeError(e: unknown): { title: string; text: string } {
  if (e instanceof ApiError) {
    if (e.code === "RATE_LIMITED" || e.status === 429) return { title: "Slow down for a moment", text: "You’ve asked several questions in quick succession. Wait a few seconds and send it again." };
    if (e.code === "NO_DATASET") return { title: "No dataset to ask about", text: "Upload a dataset before asking questions about it." };
  }
  return { title: "Lotus couldn’t answer", text: errorMessage(e) };
}

export function AssistantPage() {
  const pid = useProjectId();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const activeId = params.get("c");
  const project = useProject(pid);
  const canAsk = project.data?.role === "OWNER" || project.data?.role === "EDITOR";
  const ad = useActiveDataset();
  const conversations = useConversations(pid);
  const detail = useConversation(activeId);
  const createConv = useCreateConversation(pid);
  const del = useDeleteConversation(pid);
  const suggestions = useSuggestions(ad.dataset?.id, ad.version?.id);
  const starters = useMemo(() => buildSuggestions(suggestions.data ?? [], ad.columns), [suggestions.data, ad.columns]);

  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [railOpen, setRailOpen] = useState(false);
  const [toDelete, setToDelete] = useState<{ id: string; title: string } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const autoSent = useRef(false);

  const select = useCallback((id: string | null) => {
    setError(null); setPending(null);
    setParams((p) => { const n = new URLSearchParams(p); n.delete("q"); if (id) n.set("c", id); else n.delete("c"); return n; }, { replace: true });
  }, [setParams]);

  const send = useCallback(async (content: string, forceNew = false) => {
    const text = content.trim();
    if (text.length < 2 || sending) return;
    setSending(true); setError(null); setPending(text); setDraft("");
    let convId = forceNew ? null : activeId;
    let created = null as Awaited<ReturnType<typeof createConv.mutateAsync>> | null;
    try {
      if (!convId) {
        created = await createConv.mutateAsync({ dataset_version_id: ad.version?.id });
        convId = created.id;
      }
      const reply = await askMessage(convId, text);
      if (created) qc.setQueryData<ConversationDetail>(qk.conversation(convId), { ...created, messages: reply });
      else qc.setQueryData<ConversationDetail>(qk.conversation(convId), (d) => (d ? { ...d, messages: [...d.messages, ...reply] } : d));
      qc.invalidateQueries({ queryKey: qk.conversations(pid) });
      setPending(null);
      if (created) select(created.id);
    } catch (e) {
      if (created) { qc.invalidateQueries({ queryKey: qk.conversations(pid) }); select(created.id); }
      else if (convId) qc.invalidateQueries({ queryKey: qk.conversation(convId) });
      setPending(text); setError(e);
    } finally { setSending(false); }
  }, [activeId, ad.version?.id, createConv, pid, qc, select, sending]);

  // ?q= auto-sends once, in a fresh conversation, as soon as the dataset context is known
  const q = params.get("q");
  useEffect(() => {
    if (!q || autoSent.current || ad.loading || project.isLoading) return;
    autoSent.current = true;
    if (!canAsk || !ad.dataset) { setParams((p) => { const n = new URLSearchParams(p); n.delete("q"); return n; }, { replace: true }); return; }
    setParams((p) => { const n = new URLSearchParams(p); n.delete("q"); n.delete("c"); return n; }, { replace: true });
    void send(q, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, ad.loading, ad.dataset, project.isLoading, canAsk]);

  const messages = useMemo(() => detail.data?.messages ?? [], [detail.data]);
  useEffect(() => { endRef.current?.scrollIntoView?.({ block: "end" }); }, [messages.length, pending]);
  const lastIsPending = messages.at(-1)?.role === "user" && messages.at(-1)?.content === pending;
  const noDataset = !ad.loading && !ad.dataset;
  const boundElsewhere = detail.data?.dataset_version_id && ad.version && detail.data.dataset_version_id !== ad.version.id;
  const showThread = !!activeId || !!pending;

  return (
    <div>
      <PageHeader
        title="Ask Lotus about this dataset"
        description="Each answer is computed from your data first; the wording that follows is labelled as AI-written or rule-based."
        actions={ad.dataset && (
          <Badge variant="outline" className="gap-1.5 px-2.5 py-1 text-xs">
            <Database className="size-3" aria-hidden />
            <Link to={`/projects/${pid}/data/${ad.dataset.id}`} className="font-medium text-foreground hover:underline">{ad.dataset.name}</Link>
            {ad.version && <span>· v{ad.version.version_number}</span>}
          </Badge>
        )}
      />
      {noDataset ? (
        <EmptyState icon={<Database />} title="Upload a dataset to start asking" description="Lotus answers from the data in this project, so there’s nothing to ask about yet." action={<Button asChild><Link to={`/projects/${pid}/data`}>Go to data</Link></Button>} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
          <aside aria-label="Conversations" className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <Button variant="secondary" size="sm" className="lg:hidden" aria-expanded={railOpen} aria-controls="conv-list" onClick={() => setRailOpen((o) => !o)}><PanelLeft />Conversations</Button>
              <h2 className="hidden text-sm font-semibold lg:block">Conversations</h2>
              {canAsk && <Button size="sm" variant="accent" onClick={() => { select(null); setDraft(""); }}><MessageSquarePlus />New</Button>}
            </div>
            <div id="conv-list" className={cn("lg:block", railOpen ? "block" : "hidden")}>
              {conversations.isLoading ? <SkeletonRows n={3} />
                : conversations.isError ? <ErrorState error={conversations.error} onRetry={() => conversations.refetch()} title="Couldn’t load conversations" className="py-8" />
                  : (conversations.data ?? []).length === 0 ? <p className="rounded-lg border border-dashed px-3 py-6 text-center text-[13px] text-muted-foreground">Your conversations will be listed here.</p>
                    : (
                      <ul className="space-y-1">
                        {conversations.data!.map((c) => (
                          <li key={c.id} className={cn("group flex items-center gap-1 rounded-md", c.id === activeId ? "bg-accent" : "hover:bg-muted")}>
                            <button type="button" onClick={() => { select(c.id); setRailOpen(false); }} aria-current={c.id === activeId || undefined} className="min-w-0 flex-1 rounded-md px-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-ring">
                              <span className="block truncate text-sm font-medium">{c.title}</span>
                              <span className="text-[11px] text-muted-foreground">{fmtRelative(c.created_at)}</span>
                            </button>
                            <Button variant="ghost" size="icon-sm" className="shrink-0 opacity-70 hover:opacity-100" aria-label={`Delete conversation ${c.title}`} onClick={() => setToDelete({ id: c.id, title: c.title })}><Trash2 /></Button>
                          </li>
                        ))}
                      </ul>
                    )}
            </div>
          </aside>

          <section aria-label="Conversation" className="flex min-h-[28rem] min-w-0 flex-col rounded-xl border bg-card">
            <div className="flex-1 space-y-5 p-4 md:p-6" role="log" aria-live="polite" aria-relevant="additions">
              {boundElsewhere && <Alert variant="info">This conversation was started on a different dataset version than the one currently selected. Answers here refer to the version it was started on.</Alert>}
              {!showThread ? (
                <Starters starters={starters} loading={ad.loading || suggestions.isLoading} canAsk={canAsk} onPick={(s) => void send(s)} disabled={sending} />
              ) : detail.isLoading && activeId && !pending ? <SkeletonRows n={4} />
                : detail.isError ? <ErrorState error={detail.error} onRetry={() => detail.refetch()} title="Couldn’t open this conversation" />
                  : (
                    <>
                      {messages.map((m: Message) => m.role === "user" ? <UserBubble key={m.id} content={m.content} time={m.created_at} /> : <AssistantMessage key={m.id} message={m} projectId={pid} />)}
                      {pending && !lastIsPending && <UserBubble content={pending} />}
                      {sending && (
                        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin text-primary" aria-hidden />Routing your question → computing the analysis → interpreting the evidence…</p>
                      )}
                      {error != null && !sending && (() => { const d = describeError(error); return (
                        <Alert variant="error" title={d.title} action={pending ? <Button size="sm" variant="secondary" onClick={() => void send(pending)}>Retry</Button> : undefined}>{d.text}</Alert>
                      ); })()}
                    </>
                  )}
              <div ref={endRef} />
            </div>
            <div className="border-t p-3 md:p-4">
              {canAsk ? (
                <form onSubmit={(e) => { e.preventDefault(); void send(draft); }} className="flex items-end gap-2">
                  <div className="flex-1">
                    <label htmlFor="ask" className="sr-only">Your question</label>
                    <Textarea
                      id="ask" rows={2} value={draft} maxLength={2000} disabled={sending} className="min-h-12 resize-none"
                      placeholder="Ask about this dataset, e.g. which factors are associated with an outcome"
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(draft); } }}
                    />
                  </div>
                  <Button type="submit" disabled={draft.trim().length < 2 || sending} aria-label="Send"><SendHorizonal />Send</Button>
                </form>
              ) : project.isLoading ? null : (
                <Alert variant="info" title="Read-only access">Viewers can read conversations but can’t ask new questions. Ask the project owner for editor access.</Alert>
              )}
            </div>
          </section>
        </div>
      )}
      <ConfirmDialog
        open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)} title="Delete this conversation?" loading={del.isPending}
        description={toDelete ? `“${toDelete.title}” and its answers will be permanently removed. Analyses it created stay in the project.` : ""}
        onConfirm={() => toDelete && del.mutate(toDelete.id, { onSuccess: () => { if (toDelete.id === activeId) select(null); setToDelete(null); }, onError: () => setToDelete(null) })}
      />
    </div>
  );
}

function Starters({ starters, loading, canAsk, onPick, disabled }: { starters: string[]; loading: boolean; canAsk: boolean; onPick: (s: string) => void; disabled: boolean }) {
  return (
    <div className="mx-auto max-w-2xl py-6 text-center">
      <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-accent text-accent-foreground"><Sparkles className="size-5" aria-hidden /></div>
      <h2 className="font-display text-xl font-semibold">What would you like to know?</h2>
      <p className="mt-1 text-sm text-muted-foreground">{canAsk ? "Start with a suggestion drawn from this dataset’s columns, or write your own question." : "Suggested questions for this dataset."}</p>
      {loading ? <div className="mt-5"><SkeletonRows n={4} /></div> : (
        <ul className="mt-5 grid gap-2 text-left sm:grid-cols-2" aria-label="Suggested questions">
          {starters.map((s) => (
            <li key={s}>
              <button type="button" disabled={!canAsk || disabled} onClick={() => onPick(s)} className="h-full w-full rounded-lg border bg-background px-3.5 py-2.5 text-left text-sm transition-colors hover:border-primary/50 hover:bg-accent/40 focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60">{s}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
