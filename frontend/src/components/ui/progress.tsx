import * as P from "@radix-ui/react-progress";
import { cn } from "@/lib/utils";
export function Progress({ value, className, label }: { value: number; className?: string; label?: string }) {
  return (
    <P.Root value={value * 100} aria-label={label ?? "Progress"} className={cn("relative h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}>
      <P.Indicator className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${Math.max(2, Math.min(100, value * 100))}%` }} />
    </P.Root>
  );
}
