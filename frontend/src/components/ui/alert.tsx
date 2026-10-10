import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const tone = {
  info: { cls: "border-qual/30 bg-qual-bg text-qual", Icon: Info },
  warning: { cls: "border-warning/30 bg-warning-bg text-warning", Icon: AlertTriangle },
  error: { cls: "border-destructive/30 bg-destructive/10 text-destructive", Icon: XCircle },
  success: { cls: "border-success/30 bg-computed-bg text-success", Icon: CheckCircle2 },
};
export function Alert({ variant = "info", title, children, className, action }: { variant?: keyof typeof tone; title?: string; children?: ReactNode; className?: string; action?: ReactNode }) {
  const { cls, Icon } = tone[variant];
  return (
    <div role={variant === "error" ? "alert" : "status"} className={cn("flex gap-3 rounded-lg border px-4 py-3 text-sm", cls, className)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 space-y-0.5">{title && <p className="font-semibold">{title}</p>}{children && <div className="text-foreground/85">{children}</div>}</div>
      {action}
    </div>
  );
}
