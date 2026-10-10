import type { Metric } from "@/api/types";
import { fmtNumber, fmtP } from "@/lib/format";

/** "p = 0.191" / "p < 0.001" — the sign belongs to the formatting, the number comes from the API. */
export function pLabel(p: unknown): string {
  const s = fmtP(p);
  if (s === "—") return s;
  return s.startsWith("<") ? `p ${s}` : `p = ${s}`;
}

const P_KEY = /(^|_)p(_?value|_adj|_adjusted)?$/i;
export const isPValueMetric = (m: Pick<Metric, "key" | "label">) => P_KEY.test(m.key) || /^p[-\s]?value/i.test(m.label);

/** Display text of a metric value (p-values via fmtP, everything else via fmtNumber, unit appended). */
export function fmtMetric(m: Pick<Metric, "key" | "label" | "value" | "unit">): string {
  const v = isPValueMetric(m) && typeof m.value === "number" ? fmtP(m.value) : fmtNumber(m.value);
  return m.unit && v !== "—" ? (m.unit === "%" ? `${v}%` : `${v} ${m.unit}`) : v;
}

export function fmtDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
}
