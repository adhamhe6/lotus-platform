import { AlertTriangle, Inbox, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { ApiError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function PageHeader({ title, description, actions, eyebrow, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode; className?: string }) {
  return (
    <header className={cn("mb-6 flex flex-wrap items-end justify-between gap-4", className)}>
      <div className="min-w-0 space-y-1">
        {eyebrow && <div className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">{eyebrow}</div>}
        <h1 className="font-display text-[28px] font-semibold leading-tight">{title}</h1>
        {description && <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function EmptyState({ icon, title, description, action, className, compact }: { icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode; className?: string; compact?: boolean }) {
  return (
    <div className={cn("papyrus flex flex-col items-center justify-center rounded-xl border border-dashed bg-card/60 px-6 text-center", compact ? "py-10" : "py-16", className)}>
      <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-accent text-accent-foreground [&_svg]:size-5">{icon ?? <Inbox />}</div>
      <h3 className="font-display text-lg font-semibold">{title}</h3>
      {description && <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return "Something went wrong.";
}

export function ErrorState({ error, onRetry, title = "Couldn’t load this", className }: { error: unknown; onRetry?: () => void; title?: string; className?: string }) {
  const unauthorized = error instanceof ApiError && (error.status === 403 || error.status === 404);
  return (
    <div role="alert" className={cn("flex flex-col items-center justify-center rounded-xl border bg-card px-6 py-12 text-center", className)}>
      <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive"><AlertTriangle className="size-5" /></div>
      <h3 className="font-display text-lg font-semibold">{unauthorized ? "Not available" : title}</h3>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">{unauthorized ? "This item doesn’t exist or you don’t have access to it." : errorMessage(error)}</p>
      {onRetry && !unauthorized && <Button className="mt-5" variant="secondary" onClick={onRetry}><RefreshCw />Try again</Button>}
    </div>
  );
}

export function StatTile({ label, value, hint, tone = "default", petal, icon }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "default" | "good" | "warn"; petal?: boolean; icon?: ReactNode }) {
  return (
    <div className={cn("border bg-card p-4 shadow-xs", petal ? "petal" : "rounded-lg")}>
      <div className="flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground"><span>{label}</span>{icon && <span className="[&_svg]:size-4">{icon}</span>}</div>
      <div className={cn("tabular mt-1.5 font-display text-[26px] font-semibold leading-none", tone === "warn" && "text-warning", tone === "good" && "text-success")}>{value}</div>
      {hint && <div className="mt-1.5 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function SkeletonCards({ n = 3, className }: { n?: number; className?: string }) {
  return (
    <div className={cn("grid gap-4 sm:grid-cols-2 lg:grid-cols-3", className)} aria-busy aria-label="Loading">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="space-y-3 rounded-lg border bg-card p-5"><Skeleton className="h-5 w-2/3" /><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-5/6" /><Skeleton className="mt-4 h-8 w-1/3" /></div>
      ))}
    </div>
  );
}

export function SkeletonRows({ n = 6 }: { n?: number }) {
  return <div className="space-y-2.5" aria-busy aria-label="Loading">{Array.from({ length: n }).map((_, i) => <Skeleton key={i} className="h-9" />)}</div>;
}

export function Section({ title, description, actions, children, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div><h2 className="text-lg font-semibold">{title}</h2>{description && <p className="text-[13px] text-muted-foreground">{description}</p>}</div>
        {actions}
      </div>
      {children}
    </section>
  );
}
