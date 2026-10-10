import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useJobQuery } from "@/api/hooks";
import type { Job } from "@/api/types";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

/** Real, stage-based progress straight from the job row (never a fake percentage). */
export function JobProgressView({ job, className, compact }: { job: Pick<Job, "status" | "stage" | "progress" | "completed_stages" | "total_stages" | "error">; className?: string; compact?: boolean }) {
  const running = job.status === "PENDING" || job.status === "RUNNING";
  return (
    <div className={cn("space-y-1.5", className)} role="status" aria-live="polite">
      <div className="flex items-center gap-2 text-sm">
        {running && <Loader2 className="size-3.5 animate-spin text-primary" aria-hidden />}
        {job.status === "COMPLETED" && <CheckCircle2 className="size-3.5 text-success" aria-hidden />}
        {(job.status === "FAILED" || job.status === "CANCELLED") && <XCircle className="size-3.5 text-destructive" aria-hidden />}
        <span className={cn("truncate", !compact && "font-medium")}>{job.status === "PENDING" ? "Queued…" : job.status === "FAILED" ? (job.error?.message as string) ?? "Failed" : job.stage ?? job.status}</span>
        {running && <span className="tabular ml-auto text-xs text-muted-foreground">{job.completed_stages}/{job.total_stages}</span>}
      </div>
      {running && <Progress value={job.progress} label={job.stage ?? "Job progress"} />}
    </div>
  );
}

export function JobProgress({ jobId, className }: { jobId: string; className?: string }) {
  const { data } = useJobQuery(jobId);
  if (!data) return null;
  return <JobProgressView job={data} className={className} />;
}
