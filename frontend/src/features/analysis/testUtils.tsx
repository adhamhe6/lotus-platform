import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { http } from "msw";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ActiveDatasetProvider } from "@/lib/activeDataset";
import { AuthProvider } from "@/lib/auth";
import { JobTrackerProvider } from "@/lib/jobs";
import { ThemeProvider } from "@/lib/theme";
import { server } from "@/test/server";
import { API, j, newClient, signIn } from "@/test/utils";
import { AnalysisBuilderPage } from "./AnalysisBuilderPage";
import { AnalysisHomePage } from "./AnalysisHomePage";
import { AnalysisResultPage } from "./AnalysisResultPage";
import { InsightsPage } from "@/features/insights/InsightsPage";
import { DATASET, PID, PROFILE, PROJECT, TYPES, VERSIONS, DID } from "./fixtures";

export const MEMBERS = [{ user_id: "ad94f04a-7e28-4a45-9d4a-5db57eeb5b4a", email: "demo@lotus-demo.org", full_name: "Demo Researcher", role: "OWNER" }];

/** Signed-in session + the project/dataset/catalogue endpoints every analysis page relies on. */
export function installBase(role: "OWNER" | "EDITOR" | "VIEWER" = "OWNER") {
  signIn();
  server.use(
    http.get(`${API}/projects/${PID}`, () => j({ ...PROJECT, role })),
    http.get(`${API}/projects/${PID}/members`, () => j(MEMBERS)),
    http.get(`${API}/projects/${PID}/datasets`, () => j([DATASET])),
    http.get(`${API}/datasets/${DID}/versions`, () => j(VERSIONS)),
    http.get(`${API}/datasets/${DID}/profile`, () => j(PROFILE)),
    http.get(`${API}/analysis-types`, () => j(TYPES)),
  );
}

export const base = `/projects/${PID}`;
const Where = () => { const l = useLocation(); return <div data-testid="where">{l.pathname}{l.search}</div>; };

/** Mounts the analysis + insights routes inside the same providers as the app, with a location probe. */
export function mountAnalysis(route: string | { pathname: string; state: unknown }, extra?: ReactNode) {
  const client = newClient();
  const utils = render(
    <QueryClientProvider client={client}>
      <ThemeProvider><TooltipProvider><AuthProvider><JobTrackerProvider>
        <MemoryRouter initialEntries={[route]}>
          <ActiveDatasetProvider projectId={PID}>
            <Routes>
              <Route path="/projects/:projectId/analysis" element={<AnalysisHomePage />} />
              <Route path="/projects/:projectId/analysis/new" element={<AnalysisBuilderPage />} />
              <Route path="/projects/:projectId/analysis/:analysisId" element={<AnalysisResultPage />} />
              <Route path="/projects/:projectId/insights" element={<InsightsPage />} />
              <Route path="*" element={<div>elsewhere</div>} />
            </Routes>
            <Where />
            {extra}
          </ActiveDatasetProvider>
        </MemoryRouter>
        <Toaster />
      </JobTrackerProvider></AuthProvider></TooltipProvider></ThemeProvider>
    </QueryClientProvider>,
  );
  return { ...utils, client };
}
