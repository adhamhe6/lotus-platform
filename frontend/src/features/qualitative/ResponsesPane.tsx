import { ChevronLeft, ChevronRight, ClipboardCheck, MessagesSquare, Plus, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Code, Theme } from "@/api/types";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/common/blocks";
import { ConfirmDialog } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { SimpleSelect } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { fmtNumber } from "@/lib/format";
import { api, PAGE_SIZE, useReviewCount, useSegments, useWorkspaceMutation, type QSegment, type SegmentFilters } from "./api";
import { CodeChip, ColorDot } from "./chips";

const ALL = "__all";

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

function ResponseCard({ pid, seg, codes, themes, canWrite }: { pid: string; seg: QSegment; codes: Code[]; themes: Theme[]; canWrite: boolean }) {
  const byId = useMemo(() => new Map(codes.map((c) => [c.id, c])), [codes]);
  const review = useWorkspaceMutation(pid, (v: { id: string; status: "accepted" | "rejected" }) => api.review(pid, [v.id], v.status));
  const add = useWorkspaceMutation(pid, (codeId: string) => api.annotate(seg.id, codeId));
  const drop = useWorkspaceMutation(pid, (codeId: string) => api.unannotate(seg.id, codeId));
  const toTheme = useWorkspaceMutation(pid, (themeId: string) => api.addToTheme(themeId, seg.id));
  const fromTheme = useWorkspaceMutation(pid, (themeId: string) => api.removeFromTheme(themeId, seg.id));
  const shown = seg.annotations.filter((a) => a.status !== "rejected" && byId.has(a.code_id));
  const applied = new Set(seg.annotations.filter((a) => a.status === "accepted").map((a) => a.code_id));
  const inTheme = new Set(seg.themes.map((t) => t.id));
  const busy = review.isPending || add.isPending || drop.isPending || toTheme.isPending || fromTheme.isPending;
  return (
    <li className="space-y-2.5 rounded-lg border bg-card p-3.5">
      <p className="text-[15px] leading-relaxed">{seg.text}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        {seg.themes.map((t) => (
          <Badge key={t.id} variant="qual" className="gap-1">
            <span className="sr-only">Theme: </span>{t.name}
            {canWrite && <button type="button" disabled={busy} aria-label={`Remove from theme ${t.name}`} onClick={() => fromTheme.mutate(t.id)} className="-mr-1 rounded-full p-0.5 hover:bg-qual/15"><X className="size-3" /></button>}
          </Badge>
        ))}
        {shown.map((a) => {
          const code = byId.get(a.code_id)!;
          return <CodeChip key={a.id} code={code} annotation={a} canWrite={canWrite} busy={busy}
            onAccept={() => review.mutate({ id: a.id, status: "accepted" })} onReject={() => review.mutate({ id: a.id, status: "rejected" })} onRemove={() => drop.mutate(a.code_id)} />;
        })}
        {canWrite && (
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button size="xs" variant="ghost" aria-label="Add code to this response"><Plus />Add code</Button></DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
                <DropdownMenuLabel>Apply a code</DropdownMenuLabel>
                {codes.filter((c) => !applied.has(c.id)).map((c) => <DropdownMenuItem key={c.id} onSelect={() => add.mutate(c.id)}><ColorDot color={c.color} />{c.name}</DropdownMenuItem>)}
                {codes.every((c) => applied.has(c.id)) && <DropdownMenuLabel>All codes already applied</DropdownMenuLabel>}
              </DropdownMenuContent>
            </DropdownMenu>
            {themes.some((t) => !inTheme.has(t.id)) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild><Button size="xs" variant="ghost" aria-label="Move this response into a theme"><Plus />Theme</Button></DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
                  <DropdownMenuLabel>Add to theme</DropdownMenuLabel>
                  {themes.filter((t) => !inTheme.has(t.id)).map((t) => <DropdownMenuItem key={t.id} onSelect={() => toTheme.mutate(t.id)}>{t.name}</DropdownMenuItem>)}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        )}
      </div>
    </li>
  );
}

export function ResponsesPane({ pid, versionId, column, canWrite, codes, themes, filters, onChange }: {
  pid: string; versionId: string; column: string; canWrite: boolean; codes: Code[]; themes: Theme[];
  filters: SegmentFilters; onChange: (f: Partial<SegmentFilters>) => void;
}) {
  const [text, setText] = useState(filters.q ?? "");
  const debounced = useDebounced(text);
  useEffect(() => { if (debounced !== (filters.q ?? "")) onChange({ q: debounced || undefined }); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [debounced]);
  const segs = useSegments(pid, versionId, column, filters);
  const reviewCount = useReviewCount(pid, versionId, column);
  const [confirm, setConfirm] = useState(false);
  const acceptAll = useWorkspaceMutation(pid, (ids: string[]) => api.review(pid, ids, "accepted"), { onSuccess: () => setConfirm(false) });
  const items = segs.data?.items ?? [];
  const visibleSuggested = items.flatMap((s) => s.annotations.filter((a) => a.status === "suggested").map((a) => a.id));
  const total = segs.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = !!(filters.themeId || filters.codeId || filters.q || filters.unthemed || filters.review);

  return (
    <section aria-labelledby="resp-h" className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="resp-h" className="font-display text-lg font-semibold">Responses</h2>
        <span className="text-xs text-muted-foreground" aria-live="polite">{segs.data ? <><span className="tabular font-medium text-foreground">{fmtNumber(total)}</span> {filtered ? "matching " : ""}response{total === 1 ? "" : "s"}</> : null}</span>
      </div>

      <div className="space-y-2 rounded-lg border bg-card p-3" role="search" aria-label="Filter responses">
        <div className="relative">
          <Search aria-hidden className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input aria-label="Search response text" placeholder="Search response text…" className="pl-8" value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <SimpleSelect aria-label="Filter by theme" value={filters.themeId ?? ALL} onValueChange={(v) => onChange({ themeId: v === ALL ? undefined : v, unthemed: v === ALL ? filters.unthemed : false })}
            options={[{ value: ALL, label: "All themes" }, ...themes.map((t) => ({ value: t.id, label: t.name }))]} />
          <SimpleSelect aria-label="Filter by code" value={filters.codeId ?? ALL} onValueChange={(v) => onChange({ codeId: v === ALL ? undefined : v })}
            options={[{ value: ALL, label: "All codes" }, ...codes.map((c) => ({ value: c.id, label: c.name }))]} />
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={!!filters.unthemed} onCheckedChange={(v) => onChange({ unthemed: v === true, themeId: v === true ? undefined : filters.themeId })} />Not in any theme</label>
          <Button size="xs" variant={filters.review ? "default" : "secondary"} aria-pressed={!!filters.review} onClick={() => onChange({ review: !filters.review })}>
            <ClipboardCheck />Needs review{reviewCount.data != null && <span className="tabular rounded-full bg-black/10 px-1.5" aria-label={`${reviewCount.data} responses need review`}>{fmtNumber(reviewCount.data)}</span>}
          </Button>
          {filtered && <Button size="xs" variant="ghost" onClick={() => { setText(""); onChange({ themeId: undefined, codeId: undefined, q: undefined, unthemed: false, review: false }); }}>Clear filters</Button>}
        </div>
      </div>

      {canWrite && visibleSuggested.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed bg-accent/40 px-3 py-2 text-sm">
          <span>Suggested codes on this page are <strong>not applied</strong> until accepted.</span>
          <Button size="xs" onClick={() => setConfirm(true)}>Accept all visible ({fmtNumber(visibleSuggested.length)})</Button>
        </div>
      )}

      {segs.isLoading ? <SkeletonRows n={5} /> : segs.isError ? <ErrorState title="Couldn’t load responses" error={segs.error} onRetry={() => segs.refetch()} /> : items.length === 0 ? (
        <EmptyState compact icon={<MessagesSquare />} title={filtered ? "No responses match these filters" : "No responses in this column"}
          description={filtered ? "Loosen a filter or clear them all to see every response." : "Prepare the text column to split it into responses."}
          action={filtered ? <Button variant="secondary" onClick={() => { setText(""); onChange({ themeId: undefined, codeId: undefined, q: undefined, unthemed: false, review: false }); }}>Clear filters</Button> : undefined} />
      ) : (
        <ul className={cn("space-y-2", segs.isPlaceholderData && "opacity-60")} aria-busy={segs.isPlaceholderData}>
          {items.map((s) => <ResponseCard key={s.id} pid={pid} seg={s} codes={codes} themes={themes} canWrite={canWrite} />)}
        </ul>
      )}

      {total > PAGE_SIZE && (
        <nav className="flex items-center justify-between gap-2" aria-label="Response pages">
          <Button size="xs" variant="secondary" disabled={filters.page <= 1} onClick={() => onChange({ page: filters.page - 1 }, )}><ChevronLeft />Previous</Button>
          <span className="tabular text-xs text-muted-foreground">Page {filters.page} of {pages}</span>
          <Button size="xs" variant="secondary" disabled={filters.page >= pages} onClick={() => onChange({ page: filters.page + 1 })}>Next<ChevronRight /></Button>
        </nav>
      )}
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} destructive={false} confirmLabel="Accept all" loading={acceptAll.isPending}
        title="Accept all suggested codes on this page?" description="Every dashed suggestion currently visible becomes an accepted code. Review them first if you have not read them; you can still remove any code afterwards."
        onConfirm={() => acceptAll.mutate(visibleSuggested)} />
    </section>
  );
}
