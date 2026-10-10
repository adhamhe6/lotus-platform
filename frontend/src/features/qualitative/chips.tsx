import { Check, Sparkles, X } from "lucide-react";
import type { Code } from "@/api/types";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { QAnnotation } from "./api";

export const SOURCE_COPY: Record<string, string> = {
  keyword: "matched one of the code's keywords",
  semantic: "semantically similar to responses already coded this way",
  manual: "applied by a reviewer",
};

export function ColorDot({ color, className }: { color: string; className?: string }) {
  return <span aria-hidden className={cn("inline-block size-2.5 shrink-0 rounded-full ring-1 ring-black/10", className)} style={{ background: color }} />;
}

/** Accepted codes are solid; suggestions are dashed, labelled and need an explicit decision. Colour is never the only carrier. */
export function CodeChip({ code, annotation, canWrite, onAccept, onReject, onRemove, busy }: {
  code: Pick<Code, "id" | "name" | "color">; annotation: QAnnotation; canWrite: boolean; busy?: boolean;
  onAccept: () => void; onReject: () => void; onRemove: () => void;
}) {
  const suggested = annotation.status === "suggested";
  const how = SOURCE_COPY[annotation.source] ?? annotation.source;
  const tip = suggested
    ? `Suggested: ${how}${annotation.score != null ? ` (score ${annotation.score})` : ""}. Not applied until you accept it.`
    : annotation.source === "manual" ? "Applied by a reviewer." : `Accepted. Originally suggested: ${how}.`;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border py-0.5 pl-2 pr-1 text-xs", suggested ? "border-dashed bg-transparent" : "border-solid font-medium")}
      style={{ borderColor: code.color, background: suggested ? undefined : `color-mix(in srgb, ${code.color} 14%, var(--card))` }}>
      <Tooltip content={tip}>
        <span className="inline-flex items-center gap-1.5" tabIndex={0}>
          <ColorDot color={code.color} />
          <span>{code.name}</span>
          {suggested ? <span className="inline-flex items-center gap-0.5 text-[11px] italic text-muted-foreground"><Sparkles className="size-3" aria-hidden />suggested{annotation.score != null && <span className="tabular not-italic"> {annotation.score}</span>}</span> : <Check className="size-3 text-success" aria-label="accepted" />}
        </span>
      </Tooltip>
      {canWrite && suggested && (
        <>
          <button type="button" disabled={busy} onClick={onAccept} aria-label={`Accept code ${code.name}`} className="rounded-full p-0.5 text-success hover:bg-success/15 focus-visible:outline-2"><Check className="size-3.5" /></button>
          <button type="button" disabled={busy} onClick={onReject} aria-label={`Reject code ${code.name}`} className="rounded-full p-0.5 text-destructive hover:bg-destructive/10 focus-visible:outline-2"><X className="size-3.5" /></button>
        </>
      )}
      {canWrite && !suggested && (
        <button type="button" disabled={busy} onClick={onRemove} aria-label={`Remove code ${code.name}`} className="rounded-full p-0.5 text-muted-foreground hover:bg-muted"><X className="size-3" /></button>
      )}
    </span>
  );
}
