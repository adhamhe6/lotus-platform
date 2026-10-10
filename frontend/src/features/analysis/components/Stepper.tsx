import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/** Wizard progress. Completed steps are buttons so people can go back; later steps unlock as the earlier ones become valid. */
export function Stepper({ steps, current, maxReachable, onSelect }: { steps: readonly string[]; current: number; maxReachable: number; onSelect: (i: number) => void }) {
  const all = [...steps, "Results"];
  return (
    <nav aria-label="Analysis steps" className="mb-6">
      <ol className="flex items-center gap-1 overflow-x-auto pb-1 scroll-thin">
        {all.map((label, i) => {
          const isResults = i === steps.length;
          const done = i < current;
          const active = i === current;
          const enabled = !isResults && i <= maxReachable && !active;
          const body = (
            <>
              <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular", active && "border-primary bg-primary text-primary-foreground", done && "border-primary bg-accent text-accent-foreground", !active && !done && "text-muted-foreground")}>
                {done ? <Check className="size-3.5" aria-hidden /> : i + 1}
              </span>
              <span className={cn("text-[13px] font-medium", active ? "text-foreground" : "hidden text-muted-foreground min-[560px]:inline")}>{label}</span>
            </>
          );
          return (
            <li key={label} className="flex items-center gap-1" aria-current={active ? "step" : undefined}>
              {enabled
                ? <button type="button" onClick={() => onSelect(i)} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted" aria-label={`Go to step ${i + 1}: ${label}`}>{body}</button>
                : <span className={cn("flex items-center gap-2 px-2 py-1.5", !active && "opacity-70")}><span className="sr-only">{`Step ${i + 1}: `}</span>{body}</span>}
              {i < all.length - 1 && <span className="h-px w-3 shrink-0 bg-border min-[560px]:w-6" aria-hidden />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
