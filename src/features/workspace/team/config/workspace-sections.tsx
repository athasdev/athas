import {
  FolderOpenIcon,
  GridIcon,
  TerminalIcon,
  SparkleIcon,
  ExtensionsIcon,
  MonitorIcon,
} from "@/ui/icons";
import type { WorkbenchNavigationGroup } from "@/ui/workbench";
import type { WorkspaceSection } from "../stores/workspace-management.store";

export const WORKSPACE_SECTIONS: WorkbenchNavigationGroup<WorkspaceSection>[] = [
  {
    id: "workspace",
    label: "Workspace",
    items: [
      { id: "overview", label: "Overview", icon: <GridIcon /> },
      { id: "repositories", label: "Repositories", icon: <FolderOpenIcon /> },
      { id: "environments", label: "Environments", icon: <MonitorIcon /> },
    ],
  },
  {
    id: "team",
    label: "Team configuration",
    items: [
      { id: "tasks", label: "Tasks", icon: <TerminalIcon /> },
      { id: "ai", label: "AI & Context", icon: <SparkleIcon /> },
      { id: "extensions", label: "Integrations", icon: <ExtensionsIcon /> },
    ],
  },
];
