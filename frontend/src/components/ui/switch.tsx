import * as S from "@radix-ui/react-switch";
import * as React from "react";
import { cn } from "@/lib/utils";
export const Switch = React.forwardRef<HTMLButtonElement, React.ComponentPropsWithoutRef<typeof S.Root>>(({ className, ...p }, ref) => (
  <S.Root ref={ref} className={cn("inline-flex h-5 w-9 shrink-0 items-center rounded-full border-2 border-transparent bg-input transition-colors data-[state=checked]:bg-primary", className)} {...p}>
    <S.Thumb className="block size-4 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-4" />
  </S.Root>
));
Switch.displayName = "Switch";
