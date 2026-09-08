import type { TeamWorkspace } from "../types/team-workspace";
export interface WorkspaceSectionProps {
  root: string;
  config: TeamWorkspace;
  onChange: (config: TeamWorkspace) => void;
  reportError: (error: unknown) => void;
}
