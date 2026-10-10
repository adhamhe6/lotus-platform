import { lazy, Suspense, type ReactNode } from "react";
import { createBrowserRouter, Navigate, Outlet, RouterProvider, useLocation, type RouteObject } from "react-router-dom";
import { ProjectLayout } from "@/components/layout/ProjectLayout";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth";
import { LoginPage, RegisterPage } from "@/pages/AuthPages";
import { NotFound } from "@/pages/NotFound";
import { ProjectsPage } from "@/pages/ProjectsPage";
import { SettingsPage } from "@/pages/SettingsPage";

const pick = <T extends Record<string, React.ComponentType<never>>, K extends keyof T>(load: () => Promise<T>, k: K) => lazy(() => load().then((m) => ({ default: m[k] as React.ComponentType })));
const OverviewPage = pick(() => import("@/features/overview/OverviewPage"), "OverviewPage");
const DataPage = pick(() => import("@/features/data/DataPage"), "DataPage");
const DatasetPage = pick(() => import("@/features/data/DatasetPage"), "DatasetPage");
const AnalysisHomePage = pick(() => import("@/features/analysis/AnalysisHomePage"), "AnalysisHomePage");
const AnalysisBuilderPage = pick(() => import("@/features/analysis/AnalysisBuilderPage"), "AnalysisBuilderPage");
const AnalysisResultPage = pick(() => import("@/features/analysis/AnalysisResultPage"), "AnalysisResultPage");
const QualitativePage = pick(() => import("@/features/qualitative/QualitativePage"), "QualitativePage");
const MixedPage = pick(() => import("@/features/mixed/MixedPage"), "MixedPage");
const VisualizationsPage = pick(() => import("@/features/visualizations/VisualizationsPage"), "VisualizationsPage");
const InsightsPage = pick(() => import("@/features/insights/InsightsPage"), "InsightsPage");
const AssistantPage = pick(() => import("@/features/assistant/AssistantPage"), "AssistantPage");
const ReportsPage = pick(() => import("@/features/reports/ReportsPage"), "ReportsPage");
const ReportBuilderPage = pick(() => import("@/features/reports/ReportBuilderPage"), "ReportBuilderPage");

function Protected() {
  const { status } = useAuth();
  const loc = useLocation();
  if (status === "loading") return <div className="space-y-4 p-10" aria-busy aria-label="Loading"><Skeleton className="h-8 w-64" /><Skeleton className="h-40 w-full" /></div>;
  if (status === "anonymous") return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  return <Outlet />;
}

const page = (el: ReactNode) => <Suspense fallback={<div className="space-y-4" aria-busy aria-label="Loading"><Skeleton className="h-8 w-56" /><Skeleton className="h-64 w-full" /></div>}>{el}</Suspense>;

export const routes: RouteObject[] = [
  { path: "/login", element: <LoginPage /> },
  { path: "/register", element: <RegisterPage /> },
  {
    element: <Protected />,
    children: [
      { path: "/", element: <Navigate to="/projects" replace /> },
      { path: "/projects", element: <ProjectsPage /> },
      { path: "/settings", element: <SettingsPage /> },
      {
        path: "/projects/:projectId", element: <ProjectLayout />,
        children: [
          { index: true, element: page(<OverviewPage />) },
          { path: "data", element: page(<DataPage />) },
          { path: "data/:datasetId", element: page(<DatasetPage />) },
          { path: "analysis", element: page(<AnalysisHomePage />) },
          { path: "analysis/new", element: page(<AnalysisBuilderPage />) },
          { path: "analysis/:analysisId", element: page(<AnalysisResultPage />) },
          { path: "qualitative", element: page(<QualitativePage />) },
          { path: "mixed", element: page(<MixedPage />) },
          { path: "visualizations", element: page(<VisualizationsPage />) },
          { path: "insights", element: page(<InsightsPage />) },
          { path: "assistant", element: page(<AssistantPage />) },
          { path: "reports", element: page(<ReportsPage />) },
          { path: "reports/:reportId", element: page(<ReportBuilderPage />) },
        ],
      },
    ],
  },
  { path: "*", element: <NotFound /> },
];

export const router = createBrowserRouter(routes);
export const App = () => <RouterProvider router={router} />;
