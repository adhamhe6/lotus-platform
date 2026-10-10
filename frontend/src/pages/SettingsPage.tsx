import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Cpu, Moon, ShieldCheck, Sun } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { get, patch } from "@/api/client";
import type { User } from "@/api/types";
import { Logo } from "@/components/brand/Logo";
import { PageHeader, errorMessage } from "@/components/common/blocks";
import { Provenance } from "@/components/common/Provenance";
import { UserMenu } from "@/components/layout/Topbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";

interface AiStatus { provider: string; model: string | null; api_key_configured: boolean; embedding_provider: string; external_data_sharing: boolean; mode: string; base_url_host: string | null }

export function SettingsPage() {
  const { user, setUser } = useAuth();
  const { theme, toggle } = useTheme();
  const [name, setName] = useState(user?.full_name ?? "");
  const [saving, setSaving] = useState(false);
  const { data: ai } = useQuery({ queryKey: ["ai-status"], queryFn: () => get<AiStatus>("/ai/status") });
  return (
    <div className="min-h-screen">
      <header className="flex h-16 items-center justify-between border-b bg-sidebar px-6"><Logo /><UserMenu /></header>
      <main className="mx-auto max-w-3xl space-y-6 px-6 py-10">
        <Link to="/projects" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />Projects</Link>
        <PageHeader title="Settings" description="Your profile, appearance and how AI is configured on this server." />
        <Card>
          <CardHeader><CardTitle>Profile</CardTitle><CardDescription>{user?.email}</CardDescription></CardHeader>
          <CardContent>
            <form className="flex items-end gap-3" onSubmit={async (e) => { e.preventDefault(); setSaving(true); try { setUser(await patch<User>("/auth/me", { full_name: name })); toast.success("Profile updated"); } catch (err) { toast.error(errorMessage(err)); } finally { setSaving(false); } }}>
              <Field label="Full name" htmlFor="s-name" className="flex-1"><Input id="s-name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
              <Button type="submit" loading={saving} disabled={!name.trim() || name === user?.full_name}>Save</Button>
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Appearance</CardTitle></CardHeader>
          <CardContent><Button variant="secondary" onClick={toggle}>{theme === "dark" ? <Sun /> : <Moon />}Switch to {theme === "dark" ? "light" : "dark"} theme</Button></CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Cpu className="size-4" aria-hidden />AI &amp; data privacy</CardTitle>
            <CardDescription>Lotus computes every statistic itself. A language model, when configured, only <em>words</em> the computed evidence — and its numbers are validated.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {ai ? (
              <>
                <dl className="grid grid-cols-[10rem_1fr] gap-y-2">
                  <dt className="text-muted-foreground">Mode</dt><dd>{ai.mode}</dd>
                  <dt className="text-muted-foreground">Provider</dt><dd><Badge variant="outline">{ai.provider}</Badge>{ai.model && <span className="ml-2 font-mono text-xs">{ai.model}</span>}</dd>
                  <dt className="text-muted-foreground">Embeddings</dt><dd><Badge variant="outline">{ai.embedding_provider}</Badge></dd>
                  <dt className="text-muted-foreground">Data sent externally</dt><dd className="flex items-center gap-2"><ShieldCheck className={ai.external_data_sharing ? "size-4 text-warning" : "size-4 text-success"} aria-hidden />{ai.external_data_sharing ? `Computed evidence summaries (never raw datasets) are sent to ${ai.base_url_host ?? ai.provider}.` : "Nothing leaves this server."}</dd>
                </dl>
                <div className="flex flex-wrap gap-2 pt-1"><Provenance kind="computed" /><Provenance kind="qualitative" /><Provenance kind="ai" /><Provenance kind="rule" /></div>
                <p className="text-xs text-muted-foreground">Providers are configured by the server administrator through environment variables; API keys are never shown or returned by the API.</p>
              </>
            ) : <p className="text-muted-foreground">Loading…</p>}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
