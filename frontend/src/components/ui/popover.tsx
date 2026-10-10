import * as P from "@radix-ui/react-popover";
import * as React from "react";
import { cn } from "@/lib/utils";

export const Popover = P.Root;
export const PopoverTrigger = P.Trigger;
export const PopoverAnchor = P.Anchor;
export const PopoverContent = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<typeof P.Content>>(({ className, align = "end", sideOffset = 8, ...p }, ref) => (
  <P.Portal><P.Content ref={ref} align={align} sideOffset={sideOffset} className={cn("z-[70] w-80 rounded-lg border bg-card p-0 text-card-foreground shadow-lg animate-pop", className)} {...p} /></P.Portal>
));
PopoverContent.displayName = "PopoverContent";
