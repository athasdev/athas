import { convertFileSrc } from "@tauri-apps/api/core";
import { useCallback, useMemo, useState } from "react";
import type { KeyboardEvent, MouseEvent } from "react";
import { createPortal } from "react-dom";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { useUIState } from "@/features/window/stores/ui-state.store";
import type { ProjectTab } from "@/features/window/stores/workspace-tabs.store";
import { useWorkspaceTabsStore } from "@/features/window/stores/workspace-tabs.store";
import { createAppWindow } from "@/features/window/utils/create-app-window";
import { Button } from "@/ui/button";
import { ContextMenu, useContextMenu, type ContextMenuItem } from "@/ui/context-menu";
import {
  CaretDownIcon,
  CopyIcon,
  FolderIcon,
  FolderOpenIcon,
  ImageIcon,
  PlusIcon,
  RemoteIcon,
  WindowExpandIcon,
  XIcon,
} from "@/ui/icons";
import { Tabs } from "@/ui/tabs";
import { writeClipboardText } from "@/utils/clipboard";
import { cn } from "@/utils/cn";
import ProjectIconPicker from "../project-icon-picker";

const isRemoteProjectTab = (tab: ProjectTab) => tab.path.startsWith("remote://");

interface ProjectTabsProps {
  disableReorder?: boolean;
}

const ProjectTabs = ({ disableReorder = false }: ProjectTabsProps) => {
  const projectTabs = useWorkspaceTabsStore.use.projectTabs();
  const { reorderProjectTabs } = useWorkspaceTabsStore.getState();
  const switchToProject = useFileSystemStore((state) => state.switchToProject);
  const closeProject = useFileSystemStore((state) => state.closeProject);
  const isSwitchingProject = useFileSystemStore.use.isSwitchingProject();
  const setIsProjectPickerVisible = useUIState((state) => state.setIsProjectPickerVisible);
  const [iconPickerTab, setIconPickerTab] = useState<ProjectTab | null>(null);
  const contextMenu = useContextMenu<ProjectTab>();

  const handleTabClick = useCallback(
    async (tab: ProjectTab) => {
      if (isSwitchingProject || tab.isActive) return;
      await switchToProject(tab.id);
    },
    [isSwitchingProject, switchToProject],
  );

  const handleTabKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>, tab: ProjectTab) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      void handleTabClick(tab);
    },
    [handleTabClick],
  );

  const handleAddProject = () => {
    setIsProjectPickerVisible(true);
  };

  const handleTabActionsClick = (e: MouseEvent<HTMLElement>, tab: ProjectTab) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    contextMenu.openAt({ x: rect.right, y: rect.bottom + 4 }, tab);
  };

  const closeProjectsSequentially = useCallback(
    async (projectIds: string[]) => {
      for (const projectId of projectIds) {
        await closeProject(projectId);
      }
    },
    [closeProject],
  );

  // Build context menu items based on the selected tab
  const getContextMenuItems = useCallback(
    (tab: ProjectTab | null): ContextMenuItem[] => {
      if (!tab) return [];

      const { handleRevealInFolder } = useFileSystemStore.getState();

      const items: ContextMenuItem[] = [
        {
          id: "copy-path",
          label: "Copy Path",
          icon: <CopyIcon />,
          onClick: async () => {
            await writeClipboardText(tab.path);
          },
        },
        {
          id: "reveal",
          label: "Reveal in Finder",
          icon: <FolderOpenIcon />,
          onClick: () => {
            if (handleRevealInFolder) {
              handleRevealInFolder(tab.path);
            }
          },
        },
        {
          id: "select-icon",
          label: "Select Icon",
          icon: <ImageIcon />,
          onClick: () => {
            setIconPickerTab(tab);
          },
        },
        {
          id: "open-in-new-window",
          label: "Open in New Window",
          icon: <WindowExpandIcon />,
          onClick: () => {
            if (isRemoteProjectTab(tab)) {
              const match = tab.path.match(/^remote:\/\/([^/]+)(\/.*)?$/);
              if (!match) return;

              void createAppWindow({
                remoteConnectionId: match[1],
                remoteConnectionName: tab.name,
              });
              return;
            }

            void createAppWindow({
              path: tab.path,
              isDirectory: true,
            });
          },
        },
        {
          id: "separator-1",
          label: "",
          separator: true,
          onClick: () => {},
        },
      ];

      items.push({
        id: "close-project",
        label: "Close Project",
        icon: <XIcon />,
        onClick: () => {
          void closeProject(tab.id);
        },
      });

      items.push({
        id: "close-others",
        label: "Close Other Projects",
        onClick: () => {
          const projectIdsToClose = projectTabs.filter((t) => t.id !== tab.id).map((t) => t.id);
          void closeProjectsSequentially(projectIdsToClose);
        },
      });

      items.push({
        id: "close-right",
        label: "Close to Right",
        onClick: () => {
          const currentIndex = projectTabs.findIndex((t) => t.id === tab.id);
          if (currentIndex === -1) return;

          const projectIdsToClose = projectTabs
            .slice(currentIndex + 1)
            .reverse()
            .map((t) => t.id);
          void closeProjectsSequentially(projectIdsToClose);
        },
      });

      items.push({
        id: "close-all",
        label: "Close All Projects",
        onClick: () => {
          void closeProjectsSequentially(projectTabs.map((t) => t.id));
        },
      });

      return items;
    },
    [projectTabs, closeProject, closeProjectsSequentially],
  );

  const projectTabItems = useMemo(
    () =>
      projectTabs.map((tab) => {
        const isRemote = isRemoteProjectTab(tab);

        return {
          id: tab.id,
          role: "tab" as const,
          tabIndex: 0,
          title: tab.path,
          isActive: tab.isActive,
          onClick: () => void handleTabClick(tab),
          onContextMenu: (event: MouseEvent<HTMLDivElement>) => contextMenu.open(event, tab),
          onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => handleTabKeyDown(event, tab),
          icon: tab.customIcon ? (
            <img
              src={convertFileSrc(tab.customIcon)}
              alt=""
              className="size-(--app-ui-font-size) shrink-0 rounded-md object-contain"
            />
          ) : isRemote ? (
            <RemoteIcon />
          ) : (
            <FolderIcon />
          ),
          label: <span className="max-w-32 truncate">{tab.name}</span>,
          className: cn(
            "ui-text-sm border border-transparent px-6",
            isRemote &&
              (tab.isActive ? "bg-accent/15 text-accent" : "text-accent/85 hover:text-accent"),
            isSwitchingProject && "cursor-wait",
          ),
          action: (
            <Button
              type="button"
              variant="ghost"
              onClick={(event) => handleTabActionsClick(event, tab)}
              className={cn(
                "close-button -translate-y-1/2 absolute top-1/2 right-0.5 z-10 rounded-none border-0 text-text-lighter transition",
                "hover:bg-hover/60 hover:text-text",
                "opacity-0 group-hover/tab:opacity-100 group-focus-within/tab:opacity-100",
              )}
              tooltip="Project actions"
              aria-label="Project actions"
            >
              <CaretDownIcon />
            </Button>
          ),
        };
      }),
    [contextMenu, handleTabClick, handleTabKeyDown, isSwitchingProject, projectTabs],
  );

  if (projectTabs.length === 0) {
    return null;
  }

  return (
    <>
      <div className="group flex min-w-0 items-center">
        <Tabs
          items={projectTabItems}
          size="xs"
          variant="segmented"
          labelPosition="start"
          reorderable={!disableReorder}
          onReorder={(orderedIds) => {
            const currentIds = projectTabs.map((tab) => tab.id);
            orderedIds.forEach((tabId, targetIndex) => {
              const currentIndex = currentIds.indexOf(tabId);
              if (currentIndex === -1 || currentIndex === targetIndex) {
                return;
              }

              reorderProjectTabs(currentIndex, targetIndex);
              currentIds.splice(currentIndex, 1);
              currentIds.splice(targetIndex, 0, tabId);
            });
          }}
          className="athas-title-project-tabs-list scrollbar-hidden min-w-0 overflow-x-auto overflow-y-hidden [overscroll-behavior-x:contain]"
        />
        <div className="ml-1 flex h-6 w-7 shrink-0 items-center">
          <Button
            type="button"
            variant="ghost"
            onClick={handleAddProject}
            className="athas-title-project-add-button h-6 w-7 rounded-md border border-transparent px-0 text-text-lighter transition-colors hover:bg-hover/60 hover:text-text"
            tooltip="Open folder"
            aria-label="Open folder"
            compact
          >
            <PlusIcon />
          </Button>
        </div>
      </div>

      {createPortal(
        <ContextMenu
          isOpen={contextMenu.isOpen}
          position={contextMenu.position}
          items={getContextMenuItems(contextMenu.data)}
          onClose={contextMenu.close}
        />,
        document.body,
      )}

      {iconPickerTab &&
        createPortal(
          <ProjectIconPicker
            isOpen={!!iconPickerTab}
            onClose={() => setIconPickerTab(null)}
            projectId={iconPickerTab.id}
            projectPath={iconPickerTab.path}
          />,
          document.body,
        )}
    </>
  );
};

export default ProjectTabs;
