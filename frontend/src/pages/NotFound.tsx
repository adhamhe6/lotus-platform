import { Link } from "react-router-dom";
import { LotusMark } from "@/components/brand/Logo";
import { Button } from "@/components/ui/button";

export function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <LotusMark className="size-14 opacity-80" />
      <h1 className="font-display text-3xl font-semibold">This page doesn’t exist</h1>
      <p className="max-w-sm text-sm text-muted-foreground">The link may be old, or you may not have access to what it points to.</p>
      <Button asChild><Link to="/projects">Back to your projects</Link></Button>
    </div>
  );
}
