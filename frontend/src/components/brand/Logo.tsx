import { cn } from "@/lib/utils";

/** Geometric lotus: a centre petal, two inner petals and two outer petals — the product's only illustrative motif. */
export function LotusMark({ className, mono = false }: { className?: string; mono?: boolean }) {
  const c = mono ? { a: "currentColor", b: "currentColor", c: "currentColor" } : { a: "#e7a0b8", b: "#c4587a", c: "#8fc7bf" };
  return (
    <svg viewBox="0 0 64 64" className={cn("size-8", className)} aria-hidden fill="none" strokeLinejoin="round">
      <path d="M32 10c5.6 7.4 7.8 15.2 0 28.5C24.200 25.200 26.400 17.400 32 10Z" fill={c.a} opacity={mono ? 1 : 1} />
      <path d="M32 38.500C22.500 35.600 15.400 29.400 14 18.500c8.800.9 15.400 6.700 18 20Z" fill={c.b} />
      <path d="M32 38.500c9.500-2.900 16.600-9.100 18-20-8.800.9-15.400 6.700-18 20Z" fill={c.b} />
      <path d="M32 41c-12.500 1.200-22-2.800-26.500-11.500C15 27.300 25.600 31.500 32 41Z" fill={c.c} />
      <path d="M32 41c12.500 1.200 22-2.800 26.500-11.500C49 27.300 38.400 31.500 32 41Z" fill={c.c} />
      <path d="M12 47.500c6.700 3.300 13.800 4.800 20 4.800s13.300-1.500 20-4.800" stroke={mono ? "currentColor" : "#8fc7bf"} strokeWidth="2.200" strokeLinecap="round" opacity=".7" />
    </svg>
  );
}

export function Logo({ className, tone = "light", compact = false }: { className?: string; tone?: "light" | "dark"; compact?: boolean }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <LotusMark className="size-8" />
      {!compact && (
        <div className="leading-none">
          <div className={cn("font-display text-[21px] font-semibold tracking-tight", tone === "light" ? "text-white" : "text-foreground")}>Lotus</div>
          <div className={cn("mt-0.5 text-[9.500px] font-medium uppercase tracking-[0.2em]", tone === "light" ? "text-sidebar-muted" : "text-muted-foreground")}>Platform</div>
        </div>
      )}
    </div>
  );
}

/** Faint papyrus-column / lotus line pattern used behind the sign-in panel. */
export function LotusPattern({ className }: { className?: string }) {
  return (
    <svg className={cn("pointer-events-none absolute inset-0 size-full", className)} aria-hidden preserveAspectRatio="xMidYMax slice" viewBox="0 0 400 600" fill="none" stroke="currentColor" strokeWidth="1">
      {Array.from({ length: 9 }).map((_, i) => (
        <g key={i} transform={`translate(${i * 50 - 25} ${520 - (i % 3) * 18})`} opacity={0.5 - (i % 3) * 0.1}>
          <path d="M25 0c10 18 10 36 0 54-10-18-10-36 0-54Z" /><path d="M25 54c-14-3-22-12-24-26 12 2 21 11 24 26Z" /><path d="M25 54c14-3 22-12 24-26-12 2-21 11-24 26Z" />
          <path d="M25 54v120" /><path d="M14 174h22M17 150h16" />
        </g>
      ))}
      <circle cx="320" cy="110" r="46" opacity=".35" /><circle cx="320" cy="110" r="64" opacity=".2" /><circle cx="320" cy="110" r="84" opacity=".12" />
    </svg>
  );
}
