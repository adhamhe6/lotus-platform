import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { qk, TERMINAL, useJobQuery } from "@/api/hooks";
import type { Job } from "@/api/types";
import { titleCase } from "./format";

export interface TrackOptions { title?: string; invalidate?: QueryKey[]; onSuccess?: (job: Job) => void; onError?: (job: Job) => void; silent?: boolean }
interface Tracked { job: Job; opts: TrackOptions }
interface Ctx { tracked: Tracked[]; track: (job: Job, opts?: TrackOptions) => void; running: number; dismiss: (id: string) => void }
const JobCtx = createContext<Ctx | null>(null);

/** Tracks background jobs across pages: polls real status, refreshes affected queries and reports the outcome once. */
export function JobTrackerProvider({ children }: { children: ReactNode }) {
  const [tracked, setTracked] = useState<Tracked[]>([]);
  const qc = useQueryClient();
  const finished = useRef(new Set<string>());

  const finish = useCallback((job: Job, opts: TrackOptions) => {
    if (finished.current.has(job.id)) return;
    finished.current.add(job.id);
    (opts.invalidate ?? []).forEach((k) => qc.invalidateQueries({ queryKey: k }));
    qc.invalidateQueries({ queryKey: qk.jobs(job.project_id) });
    qc.invalidateQueries({ queryKey: qk.notifications });
    qc.invalidateQueries({ queryKey: qk.unread });
    qc.invalidateQueries({ queryKey: qk.overview(job.project_id) });
    const title = opts.title ?? titleCase(job.type);
    if (job.status === "COMPLETED") { if (!opts.silent) toast.success(`${title} finished`); opts.onSuccess?.(job); }
    else if (job.status === "FAILED") { toast.error(`${title} failed`, { description: job.error?.message as string | undefined }); opts.onError?.(job); }
    else if (job.status === "CANCELLED") toast(`${title} cancelled`);
  }, [qc]);

  const track = useCallback((job: Job, opts: TrackOptions = {}) => {
    qc.setQueryData(qk.job(job.id), job);
    if (TERMINAL.has(job.status)) { finish(job, opts); return; }
    setTracked((t) => (t.some((x) => x.job.id === job.id) ? t : [...t, { job, opts }]));
  }, [qc, finish]);

  const dismiss = useCallback((id: string) => setTracked((t) => t.filter((x) => x.job.id !== id)), []);
  const value = useMemo<Ctx>(() => ({ tracked, track, dismiss, running: tracked.filter((t) => !TERMINAL.has(t.job.status)).length }), [tracked, track, dismiss]);

  return (
    <JobCtx.Provider value={value}>
      {children}
      {tracked.map((t) => <Watcher key={t.job.id} t={t} onDone={(job) => { finish(job, t.opts); setTimeout(() => dismiss(job.id), 4000); }} onUpdate={(job) => setTracked((all) => all.map((x) => (x.job.id === job.id ? { ...x, job } : x)))} />)}
    </JobCtx.Provider>
  );
}

function Watcher({ t, onDone, onUpdate }: { t: Tracked; onDone: (j: Job) => void; onUpdate: (j: Job) => void }) {
  const { data } = useJobQuery(t.job.id);
  useEffect(() => {
    if (!data) return;
    onUpdate(data);
    if (TERMINAL.has(data.status)) onDone(data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.status, data?.completed_stages, data?.stage]);
  return null;
}

export function useJobs() {
  const v = useContext(JobCtx);
  if (!v) throw new Error("useJobs outside JobTrackerProvider");
  return v;
}
