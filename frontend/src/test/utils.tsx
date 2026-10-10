import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderOptions } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactElement, ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";
import { setAccessToken } from "@/api/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ActiveDatasetProvider } from "@/lib/activeDataset";
import { AuthProvider } from "@/lib/auth";
import { JobTrackerProvider } from "@/lib/jobs";
import { ThemeProvider } from "@/lib/theme";
import { server } from "./server";

export const API = "http://localhost:3000/api/v1";
export const USER = { id: "u1", email: "ana@example.com", full_name: "Ana Researcher", created_at: "2026-01-01T00:00:00Z" };
export const j = (data: unknown, status = 200) => HttpResponse.json(data as never, { status });
export const apiError = (status: number, code: string, message: string) => HttpResponse.json({ error: { code, message } }, { status });

/** Signed-in session handlers (refresh cookie present). Call before render. */
export function signIn() {
  setAccessToken("test-token");
  server.use(
    http.post(`${API}/auth/refresh`, () => j({ access_token: "test-token", token_type: "bearer", expires_in: 1800, user: USER })),
    http.get(`${API}/auth/me`, () => j(USER)),
  );
}
export function signedOut() {
  setAccessToken(null);
  server.use(http.post(`${API}/auth/refresh`, () => apiError(401, "NO_REFRESH_TOKEN", "No active session.")));
}

export function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 }, mutations: { retry: false } } });
}

interface Opts extends Omit<RenderOptions, "wrapper"> { route?: string; path?: string; client?: QueryClient; withProject?: string }

/** Render a page inside every provider it needs, at a router location. */
export function renderApp(ui: ReactElement, { route = "/", path = "*", client = newClient(), withProject, ...rest }: Opts = {}) {
  const wrap = (children: ReactNode) => (withProject ? <ActiveDatasetProvider projectId={withProject}>{children}</ActiveDatasetProvider> : children);
  const utils = render(
    <QueryClientProvider client={client}>
      <ThemeProvider><TooltipProvider>
        <AuthProvider><JobTrackerProvider>
          <MemoryRouter initialEntries={[route]}>
            <Routes><Route path={path} element={wrap(ui)} /><Route path="*" element={<div data-testid="elsewhere">elsewhere</div>} /></Routes>
          </MemoryRouter>
          <Toaster />
        </JobTrackerProvider></AuthProvider>
      </TooltipProvider></ThemeProvider>
    </QueryClientProvider>, rest);
  return { ...utils, client };
}
