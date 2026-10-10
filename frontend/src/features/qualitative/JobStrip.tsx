import type { QueryKey } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { TERMINAL, useJobQuery } from "@/api/hooks";
import type { Job } from "@/api/types";
import { JobProgressView } from "@/components/common/JobProgress";
import { Button } from "@/components/ui/button";
import { useJobs } from "@/lib/jobs";

interface Started { id: string; title: string }

/** Starts background jobs through the global tracker and remembers them so this page can show real progress inline. */
export function useFeatureJobs() {
  const { track } = useJobs();
  const [started, setStarted] = useState<Started[]>([]);
  const start = useCallback((job: Job, title: string, invalidate: QueryKey[], onSuccess?: (job: Job) => void) => {
    setStarted((s) => [...s.filter((x) => x.id !== job.id), { id: job.id, title }]);
    track(job, { title, invalidate, onSuccess });
  }, [track]);
  const dismiss = useCallback((id: string) => setStarted((s) => s.filter((x) => x.id !== id)), []);
  return { started, start, dismiss };
}

function Item({ s, onDismiss }: { s: Started; onDismiss: (id: string) => void }) {
  const { data } = useJobQuery(s.id);
  const done = !!data && TERMINAL.has(data.status);
  useEffect(() => {
    if (data?.status !== "COMPLETED") return;
    const t = setTimeout(() => onDismiss(s.id), 6000);
    return () => clearTimeout(t);
  }, [data?.status, onDismiss, s.id]);
  if (!data) return null;
  return (
    <div className="flex items-start gap-3 rounded-lg border bg-card px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{s.title}</div>
        <JobProgressView job={data} />
      </div>
      {done && <Button size="xs" variant="ghost" onClick={() => onDismiss(s.id)}>Dismiss</Button>}
    </div>
  );
}

export function JobStrip({ started, onDismiss }: { started: Started[]; onDismiss: (id: string) => void }) {
  if (!started.length) return null;
  return <div className="space-y-2" aria-label="Background jobs">{started.map((s) => <Item key={s.id} s={s} onDismiss={onDismiss} />)}</div>;
}
