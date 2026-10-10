/** Series colours are CSS variables (light/dark selected in index.css; validated colour-blind-safe order). Never cycle past 8: fold into "Other". */
export const SERIES = ["var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)", "var(--s5)", "var(--s6)", "var(--s7)", "var(--s8)"];
export const seriesColor = (i: number) => SERIES[i % SERIES.length];
export const SEQ = ["var(--seq-0)", "var(--seq-1)", "var(--seq-2)", "var(--seq-3)", "var(--seq-4)", "var(--seq-5)", "var(--seq-6)"];

/** Sequential colour for t∈[0,1]. */
export const seqColor = (t: number) => SEQ[Math.max(0, Math.min(SEQ.length - 1, Math.round(t * (SEQ.length - 1))))];

/** Diverging blue↔orange with a neutral midpoint, t∈[-1,1]. */
export function divColor(t: number): string {
  const a = Math.min(1, Math.abs(t));
  const pole = t < 0 ? "var(--div-neg)" : "var(--div-pos)";
  return `color-mix(in oklab, ${pole} ${Math.round(a * 100)}%, var(--div-mid))`;
}
export const textOn = (t: number) => (Math.abs(t) > 0.55 ? "#fff" : "var(--chart-text)");
