import { zodResolver } from "@hookform/resolvers/zod";
import { Share2, Trash2, UserPlus } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { ApiError } from "@/api/client";
import { useMembers } from "@/api/hooks";
import type { Member, Role } from "@/api/types";
import { ErrorState, errorMessage } from "@/components/common/blocks";
import { Alert } from "@/components/ui/alert";
import { ConfirmDialog } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { SimpleSelect } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useAddMember, useChangeMemberRole, useRemoveMember } from "./overviewApi";

const schema = z.object({ email: z.string().trim().email("Enter a valid e-mail address."), role: z.enum(["EDITOR", "VIEWER"]) });
type Form = z.infer<typeof schema>;

const ROLE_OPTIONS = [
  { value: "EDITOR", label: "Editor", hint: "can analyse and edit" },
  { value: "VIEWER", label: "Viewer", hint: "read-only" },
];
const ROLE_LABEL: Record<Role, string> = { OWNER: "Owner", EDITOR: "Editor", VIEWER: "Viewer" };

/** Project sharing: everyone can see who has access; only the owner can add people, change roles or remove them. */
export function ShareDialog({ projectId, role }: { projectId: string; role?: Role }) {
  const [open, setOpen] = useState(false);
  const isOwner = role === "OWNER";
  const members = useMembers(projectId);
  const add = useAddMember(projectId);
  const change = useChangeMemberRole(projectId);
  const remove = useRemoveMember(projectId);
  const [rowError, setRowError] = useState<string | null>(null);
  const [toRemove, setToRemove] = useState<Member | null>(null);
  const form = useForm<Form>({ resolver: zodResolver(schema), defaultValues: { email: "", role: "VIEWER" } });

  const submit = form.handleSubmit((v) => {
    setRowError(null);
    add.mutate(v, { onSuccess: () => form.reset({ email: "", role: v.role }) });
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { add.reset(); setRowError(null); } }}>
      <DialogTrigger asChild><Button variant="secondary"><Share2 />Share</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share this project</DialogTitle>
          <DialogDescription>{isOwner ? "People you add can open this project with the role you choose." : "Only the project owner can change who has access."}</DialogDescription>
        </DialogHeader>

        {isOwner && (
          <form onSubmit={submit} className="space-y-3" noValidate>
            <div className="grid gap-3 sm:grid-cols-[1fr_9rem_auto] sm:items-end">
              <Field label="E-mail address" htmlFor="share-email" error={form.formState.errors.email?.message}>
                <Input id="share-email" type="email" autoComplete="off" placeholder="colleague@organisation.org" {...form.register("email")} />
              </Field>
              <Field label="Role" htmlFor="share-role">
                <SimpleSelect id="share-role" value={form.watch("role")} onValueChange={(v) => form.setValue("role", v as Form["role"])} options={ROLE_OPTIONS} />
              </Field>
              <Button type="submit" loading={add.isPending}><UserPlus />Add</Button>
            </div>
            {add.isError && <Alert variant="error" title={add.error instanceof ApiError && add.error.code === "USER_NOT_FOUND" ? "Nobody has that e-mail yet" : "Couldn’t add this person"}>{errorMessage(add.error)}</Alert>}
          </form>
        )}

        {rowError && <Alert variant="error">{rowError}</Alert>}

        <div>
          <h3 className="mb-2 text-sm font-semibold">People with access</h3>
          {members.isLoading ? <div className="space-y-2" aria-busy aria-label="Loading members"><Skeleton className="h-12" /><Skeleton className="h-12" /></div>
            : members.isError ? <ErrorState error={members.error} onRetry={() => members.refetch()} title="Couldn’t load members" className="py-8" />
              : (
                <ul className="divide-y rounded-lg border">
                  {(members.data ?? []).map((m) => (
                    <li key={m.user_id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{m.full_name}</p>
                        <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {m.role === "OWNER" || !isOwner ? <Badge variant={m.role === "OWNER" ? "primary" : "default"}>{ROLE_LABEL[m.role]}</Badge> : (
                          <>
                            <SimpleSelect
                              aria-label={`Role for ${m.full_name}`} className="h-8 w-32" value={m.role} options={ROLE_OPTIONS}
                              onValueChange={(v) => { setRowError(null); change.mutate({ userId: m.user_id, role: v as "EDITOR" | "VIEWER" }, { onError: (e) => setRowError(errorMessage(e)) }); }}
                            />
                            <Button variant="ghost" size="icon-sm" aria-label={`Remove ${m.full_name}`} onClick={() => setToRemove(m)}><Trash2 /></Button>
                          </>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
        </div>
      </DialogContent>
      <ConfirmDialog
        open={!!toRemove} onOpenChange={(o) => !o && setToRemove(null)} title="Remove this person?" confirmLabel="Remove" loading={remove.isPending}
        description={toRemove ? `${toRemove.full_name} (${toRemove.email}) will no longer be able to open this project.` : ""}
        onConfirm={() => toRemove && remove.mutate(toRemove.user_id, { onSuccess: () => setToRemove(null), onError: (e) => { setToRemove(null); setRowError(errorMessage(e)); } })}
      />
    </Dialog>
  );
}
