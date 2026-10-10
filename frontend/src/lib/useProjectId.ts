import { useParams } from "react-router-dom";
export function useProjectId(): string {
  const { projectId } = useParams();
  if (!projectId) throw new Error("No project in route");
  return projectId;
}
