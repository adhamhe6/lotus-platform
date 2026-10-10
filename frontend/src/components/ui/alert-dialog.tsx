import * as AD from "@radix-ui/react-alert-dialog";
import type { ReactNode } from "react";
import { Button } from "./button";

export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel = "Delete", destructive = true, onConfirm, loading }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; description: ReactNode; confirmLabel?: string; destructive?: boolean; onConfirm: () => void; loading?: boolean;
}) {
  return (
    <AD.Root open={open} onOpenChange={onOpenChange}>
      <AD.Portal>
        <AD.Overlay className="fixed inset-0 z-50 bg-[#06161a]/55 backdrop-blur-[2px] animate-fade-in" />
        <AD.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 space-y-4 rounded-xl border bg-card p-6 shadow-2xl animate-pop">
          <AD.Title className="font-display text-xl font-semibold">{title}</AD.Title>
          <AD.Description className="text-sm text-muted-foreground">{description}</AD.Description>
          <div className="flex justify-end gap-2">
            <AD.Cancel asChild><Button variant="secondary">Cancel</Button></AD.Cancel>
            <Button variant={destructive ? "destructive" : "default"} loading={loading} onClick={onConfirm}>{confirmLabel}</Button>
          </div>
        </AD.Content>
      </AD.Portal>
    </AD.Root>
  );
}
