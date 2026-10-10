import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, refreshSession, setAccessToken, setAuthLostHandler, ApiError } from "@/api/client";
import type { User } from "@/api/types";

interface AuthState {
  user: User | null;
  status: "loading" | "authenticated" | "anonymous";
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, fullName: string) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (u: User) => void;
}
const Ctx = createContext<AuthState | null>(null);

interface TokenResponse { access_token: string; user: User }

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthState["status"]>("loading");
  const qc = useQueryClient();

  const clear = useCallback(() => { setAccessToken(null); setUser(null); setStatus("anonymous"); qc.clear(); }, [qc]);

  useEffect(() => {
    setAuthLostHandler(clear);
    let alive = true;
    (async () => {
      const t = await refreshSession();
      if (!alive) return;
      if (!t) { setStatus("anonymous"); return; }
      try { setUser(await api<User>("/auth/me")); setStatus("authenticated"); } catch { if (alive) setStatus("anonymous"); }
    })();
    return () => { alive = false; setAuthLostHandler(null); };
  }, [clear]);

  const finish = (r: TokenResponse) => { setAccessToken(r.access_token); setUser(r.user); setStatus("authenticated"); };
  const value = useMemo<AuthState>(() => ({
    user, status, setUser,
    login: async (email, password) => finish(await api<TokenResponse>("/auth/login", { method: "POST", body: { email, password } })),
    register: async (email, password, full_name) => finish(await api<TokenResponse>("/auth/register", { method: "POST", body: { email, password, full_name } })),
    logout: async () => { try { await api("/auth/logout", { method: "POST" }); } catch (e) { if (!(e instanceof ApiError)) throw e; } clear(); },
  }), [user, status, clear]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}
