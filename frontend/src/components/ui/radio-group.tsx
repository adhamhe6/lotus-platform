import * as R from "@radix-ui/react-radio-group";
import * as React from "react";
import { cn } from "@/lib/utils";
export const RadioGroup = R.Root;
export const RadioItem = React.forwardRef<HTMLButtonElement, React.ComponentPropsWithoutRef<typeof R.Item>>(({ className, ...p }, ref) => (
  <R.Item ref={ref} className={cn("flex size-4 items-center justify-center rounded-full border border-input bg-card data-[state=checked]:border-primary", className)} {...p}>
    <R.Indicator className="size-2 rounded-full bg-primary" />
  </R.Item>
));
RadioItem.displayName = "RadioItem";
