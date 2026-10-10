import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const badge = cva("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4 whitespace-nowrap", {
  variants: {
    variant: {
      default: "bg-muted text-foreground/80 border-transparent",
      outline: "bg-transparent text-muted-foreground",
      primary: "bg-accent text-accent-foreground border-transparent",
      success: "bg-computed-bg text-success border-transparent",
      warning: "bg-warning-bg text-warning border-transparent",
      destructive: "bg-destructive/10 text-destructive border-transparent",
      computed: "bg-computed-bg text-computed border-transparent",
      qual: "bg-qual-bg text-qual border-transparent",
      ai: "bg-ai-bg text-ai border-transparent",
      rule: "bg-rule-bg text-rule border-transparent",
    },
  },
  defaultVariants: { variant: "default" },
});

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badge> {}
export const Badge = ({ className, variant, ...props }: BadgeProps) => <span className={cn(badge({ variant }), className)} {...props} />;
