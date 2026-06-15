import {
  ClockIcon,
  FolderPlusIcon as FolderPlus,
  FolderOpenIcon as FolderOpen,
  SidebarSimpleIcon as PanelTopClose,
} from "@phosphor-icons/react";
import { useMemo } from "react";
import { useRecentFoldersStore } from "@/features/file-system/stores/recent-folders.store";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import type { RecentFolder } from "@/features/file-system/types/recent-folders.types";
import { MAX_RECENT_PROJECTS } from "@/features/file-system/utils/recent-folders";
import { useUIState } from "@/features/window/stores/ui-state.store";
import { ContextMenu, type ContextMenuItem } from "@/ui/context-menu";

export const ProjectNameMenu = () => {
  const { projectNameMenu, setProjectNameMenu } = useUIState();
  const { addFolderToWorkspace, handleOpenFolder, handleCollapseAllFolders } = useFileSystemStore();
  const { recentFolders, openRecentFolder } = useRecentFoldersStore();

  const items = useMemo<ContextMenuItem[]>(() => {
    const baseItems: ContextMenuItem[] = [
      {
        id: "open-folder",
        label: "Open Folder in New Tab",
        icon: <FolderOpen />,
        onClick: () => handleOpenFolder(),
      },
      {
        id: "add-folder-to-workspace",
        label: "Add Folder to Workspace",
        icon: <FolderPlus />,
        onClick: () => {
          void addFolderToWorkspace();
        },
      },
      {
        id: "collapse-folders",
        label: "Collapse All Folders",
        icon: <PanelTopClose />,
        onClick: () => handleCollapseAllFolders(),
      },
    ];

    if (recentFolders.length === 0) {
      return baseItems;
    }

    const recentItems: ContextMenuItem[] = recentFolders
      .slice(0, MAX_RECENT_PROJECTS)
      .map((folder: RecentFolder) => ({
        id: `recent-${folder.path}`,
        label: folder.name,
        icon: <ClockIcon />,
        onClick: () => openRecentFolder(folder.path),
      }));

    return [
      ...baseItems,
      { id: "sep-recent", label: "", separator: true, onClick: () => {} },
      ...recentItems,
    ];
  }, [
    addFolderToWorkspace,
    handleCollapseAllFolders,
    handleOpenFolder,
    openRecentFolder,
    recentFolders,
  ]);

  if (!projectNameMenu) return null;

  return (
    <ContextMenu
      isOpen
      position={{ x: projectNameMenu.x, y: projectNameMenu.y }}
      items={items}
      onClose={() => setProjectNameMenu(null)}
      className="min-w-[220px]"
    />
  );
};
