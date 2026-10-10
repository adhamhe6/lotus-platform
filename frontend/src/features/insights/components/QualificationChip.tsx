import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";

export const QUALIFICATION = {
  strong: { label: "Strong", variant: "success", tip: "Very unlikely to be chance (p < 0.001) with a sizeable effect, on enough observations." },
  moderate: { label: "Moderate", variant: "primary", tip: "Statistically reliable (p < 0.01) with a meaningful effect size." },
  tentative: { label: "Tentative", variant: "warning", tip: "Clears the minimum bar (n ≥ 30, p < 0.05 and a minimum effect size) but no more. Treat it as a lead to check, not a conclusion." },
} as const;

/** Evidence strength of an insight. The tooltip spells out what the label means; the word itself carries the meaning (not colour). */
export function QualificationChip({ value }: { value: string }) {
  const q = QUALIFICATION[value as keyof typeof QUALIFICATION] ?? QUALIFICATION.tentative;
  return (
    <Tooltip content={q.tip}>
      <button type="button" aria-label={`${q.label} evidence. ${q.tip}`} className="rounded-full focus-visible:outline-2 focus-visible:outline-ring">
        <Badge variant={q.variant}>{q.label}</Badge>
      </button>
    </Tooltip>
  );
}
