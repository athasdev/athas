import { type ReactNode, useMemo } from "react";
import { DynamicIcon } from "@/extensions/ui/components/dynamic-icon";
import { ExtensionErrorBoundary } from "@/extensions/ui/components/extension-error-boundary";
import { useExtensionViews } from "@/extensions/ui/hooks/use-extension-views";
import { useAuthStore } from "@/features/auth/stores/auth.store";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { getProjectToolPaneId } from "@/features/layout/services/dock-pane-registry";
import {
  getSidebarViews,
  type SidebarViewDefinition,
} from "@/features/layout/services/sidebar-view-registry";
import type { DockPaneId } from "@/features/layout/types/dock.types";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useProjectStore } from "@/features/workspace/stores/project.store";

/** Project tools in the order menus list them; any others follow by registration order. */
const TOOL_ORDER = [
  "files",
  "git",
  "github-prs",
  "docker",
  "databases",
  "views",
  "workspaces",
  "collaboration",
];

export interface ProjectTool {
  view: string;
  paneId: DockPaneId;
  title: string;
  icon: ReactNode;
  render: () => ReactNode;
}

function RegisteredToolView({ definition }: { definition: SidebarViewDefinition<object> }) {
  const rootFolderPath = useProjectStore((state) => state.rootFolderPath);
  const handleFileSelect = useFileSystemStore((state) => state.handleFileSelect);
  const View = definition.component;
  const props =
    definition.getProps?.({ rootFolderPath, onFileSelect: handleFileSelect, isActive: true }) ?? {};
  return (
    <div data-external-file-drop-scope="sidebar" className="flex min-h-0 flex-1 flex-col">
      <View {...props} />
    </div>
  );
}

function rank(view: string) {
  const index = TOOL_ORDER.indexOf(view);
  return index === -1 ? TOOL_ORDER.length : index;
}

/** The project tools on offer: every available sidebar view and every extension view. */
export function useProjectTools(): ProjectTool[] {
  const extensionViews = useExtensionViews();
  const coreFeatures = useSettingsStore((state) => state.settings.coreFeatures);
  const hasTeamsCollaborationAccess = useAuthStore(
    (state) => state.subscription?.collaboration?.enabled === true,
  );

  return useMemo(() => {
    const availability = { coreFeatures, hasTeamsCollaborationAccess };
    const registered = getSidebarViews()
      .filter((definition) => definition.isAvailable?.(availability) ?? true)
      .sort((left, right) => rank(left.id) - rank(right.id))
      .map((definition): ProjectTool => ({
        view: definition.id,
        paneId: getProjectToolPaneId(definition.id),
        title: definition.title,
        icon: definition.icon,
        render: () => <RegisteredToolView definition={definition} />,
      }));
    const contributed = Array.from(extensionViews.values()).map((view): ProjectTool => ({
      view: view.id,
      paneId: getProjectToolPaneId(view.id),
      title: view.title,
      icon: <DynamicIcon name={view.icon} />,
      render: () => (
        <ExtensionErrorBoundary extensionId={view.extensionId} name={view.title}>
          {view.render()}
        </ExtensionErrorBoundary>
      ),
    }));
    return [...registered, ...contributed];
  }, [coreFeatures, extensionViews, hasTeamsCollaborationAccess]);
}
