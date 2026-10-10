import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useDatasets, useProfile, useVersions } from "@/api/hooks";
import type { Column, Dataset, DatasetVersion } from "@/api/types";

interface Active {
  datasets: Dataset[];
  loading: boolean;
  dataset?: Dataset;
  version?: DatasetVersion;
  versions: DatasetVersion[];
  columns: Column[];
  setDataset: (id: string) => void;
  setVersion: (id: string) => void;
}
const Ctx = createContext<Active | null>(null);
const key = (pid: string) => `lotus.active.${pid}`;

/** "Which dataset / version am I working with?" — one answer for the whole project workspace. */
export function ActiveDatasetProvider({ projectId, children }: { projectId: string; children: ReactNode }) {
  const { data: datasets = [], isLoading } = useDatasets(projectId);
  const [sel, setSel] = useState<{ d?: string; v?: string }>(() => { try { return JSON.parse(localStorage.getItem(key(projectId)) ?? "{}"); } catch { return {}; } });
  const ready = datasets.filter((d) => d.status === "READY");
  const dataset = ready.find((d) => d.id === sel.d) ?? ready[0];
  const { data: versions = [] } = useVersions(dataset?.id);
  const version = versions.find((v) => v.id === sel.v) ?? versions[versions.length - 1] ?? undefined;
  const { data: profile } = useProfile(dataset?.id, version?.id);

  useEffect(() => { try { localStorage.setItem(key(projectId), JSON.stringify({ d: dataset?.id, v: version?.id })); } catch { /* storage unavailable */ } }, [projectId, dataset?.id, version?.id]);
  const setDataset = useCallback((id: string) => setSel({ d: id }), []);
  const setVersion = useCallback((id: string) => setSel((s) => ({ ...s, v: id })), []);
  const value = useMemo<Active>(() => ({ datasets, loading: isLoading, dataset, version, versions, columns: profile?.columns ?? [], setDataset, setVersion }), [datasets, isLoading, dataset, version, versions, profile, setDataset, setVersion]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useActiveDataset() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useActiveDataset outside a project workspace");
  return v;
}
