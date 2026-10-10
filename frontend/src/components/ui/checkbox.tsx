import * as C from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";
export const Checkbox = React.forwardRef<HTMLButtonElement, React.ComponentPropsWithoutRef<typeof C.Root>>(({ className, ...p }, ref) => (
  <C.Root ref={ref} className={cn("flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-input bg-card data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground", className)} {...p}>
    <C.Indicator><Check className="size-3" strokeWidth={3} /></C.Indicator>
  </C.Root>
));
Checkbox.displayName = "Checkbox";
