import { BarChart3, Database, FileText, GitMerge, LayoutDashboard, Lightbulb, LineChart, MessagesSquare, Sparkles, type LucideIcon } from "lucide-react";

export interface NavItem { to: string; label: string; icon: LucideIcon; end?: boolean; group: "workspace" | "analyse" | "communicate" }
export const PROJECT_NAV: NavItem[] = [
  { to: "", label: "Overview", icon: LayoutDashboard, end: true, group: "workspace" },
  { to: "data", label: "Data", icon: Database, group: "workspace" },
  { to: "analysis", label: "Analysis", icon: BarChart3, group: "analyse" },
  { to: "qualitative", label: "Qualitative", icon: MessagesSquare, group: "analyse" },
  { to: "mixed", label: "Mixed methods", icon: GitMerge, group: "analyse" },
  { to: "visualizations", label: "Visualizations", icon: LineChart, group: "analyse" },
  { to: "insights", label: "Insights", icon: Lightbulb, group: "communicate" },
  { to: "assistant", label: "AI Assistant", icon: Sparkles, group: "communicate" },
  { to: "reports", label: "Reports", icon: FileText, group: "communicate" },
];
export const GROUP_LABEL = { workspace: "Workspace", analyse: "Analyse", communicate: "Communicate" } as const;
