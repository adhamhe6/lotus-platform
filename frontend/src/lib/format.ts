/** Number/date formatting shared by tables, metrics and charts. Values are shown, never recomputed here. */
export function fmtNumber(v: unknown, digits = 3): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "string") return v;
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  if (Number.isInteger(v) && Math.abs(v) < 1e15) return v.toLocaleString("en-US");
  const a = Math.abs(v);
  if (a !== 0 && a < 0.001) return v.toExponential(1);
  if (a >= 10000) return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (a >= 100) return v.toLocaleString("en-US", { maximumFractionDigits: 1 });
  if (a >= 10) return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return Number(v.toFixed(digits)).toString();
}

export function fmtP(p: unknown): string {
  if (typeof p !== "number" || !Number.isFinite(p)) return "—";
  if (p < 0.001) return "< 0.001";
  return p.toFixed(3);
}

export const fmtPct = (v: unknown, digits = 1) => (typeof v === "number" && Number.isFinite(v) ? `${v.toFixed(digits)}%` : "—");

export function fmtDate(iso: string | null | undefined, withTime = false): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}) });
}

export function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 14) return `${Math.round(s / 86400)} d ago`;
  return fmtDate(iso);
}

export const fmtBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

export const titleCase = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export const SEMANTIC_LABEL: Record<string, string> = {
  numeric_continuous: "Numeric", numeric_discrete: "Discrete", binary: "Binary", boolean: "Boolean", categorical: "Category",
  datetime: "Date/time", text: "Text", identifier: "Identifier",
};
