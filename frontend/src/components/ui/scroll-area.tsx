import * as S from "@radix-ui/react-scroll-area";
import { cn } from "@/lib/utils";
export function ScrollArea({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <S.Root className={cn("relative overflow-hidden", className)}>
      <S.Viewport className="size-full rounded-[inherit]">{children}</S.Viewport>
      <S.Scrollbar orientation="vertical" className="flex w-2 touch-none select-none p-px"><S.Thumb className="relative flex-1 rounded-full bg-border" /></S.Scrollbar>
    </S.Root>
  );
}
