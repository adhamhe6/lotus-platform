import { cn } from "@/lib/utils";
export const Skeleton = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => <div aria-hidden className={cn("skeleton h-4 w-full", className)} {...p} />;
