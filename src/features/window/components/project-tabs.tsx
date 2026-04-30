import { convertFileSrc } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  Copy,
  DotsThreeVertical,
  Folder,
  FolderOpen,
  HardDrives,
  Image,
  Plus,
  X,
  ArrowSquareOut,
} from "@phosphor-icons/react";
import { useCallback, useMemo, useState } from "react";
import type { KeyboardEvent, MouseEvent } from "react";
import { createPortal } from "react-dom";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import { useUIState } from "@/features/window/stores/ui-state-store";
import type { ProjectTab } from "@/features/window/stores/workspace-tabs-store";
import { useWorkspaceTabsStore } from "@/features/window/stores/workspace-tabs-store";
import { createAppWindow } from "@/features/window/utils/create-app-window";
import { Button } from "@/ui/button";
import { ContextMenu, useContextMenu, type ContextMenuItem } from "@/ui/context-menu";
import { Tabs } from "@/ui/tabs";
import { cn } from "@/utils/cn";
import ProjectIconPicker from "./project-icon-picker";
import ProjectPickerDialog from "./project-picker-dialog";

const isRemoteProjectTab = (tab: ProjectTab) => tab.path.startsWith("remote://");

interface ProjectTabsProps {
  disableReorder?: boolean;
}

const ProjectTabs = ({ disableReorder = false }: ProjectTabsProps) => {
  const projectTabs = useWorkspaceTabsStore.use.projectTabs();
  const { reorderProjectTabs } = useWorkspaceTabsStore.getState();
  const { switchToProject, closeProject } = useFileSystemStore();
  const isSwitchingProject = useFileSystemStore.use.isSwitchingProject();
  const { isProjectPickerVisible, setIsProjectPickerVisible } = useUIState();
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

  // Build context menu items based on the selected tab
  const getContextMenuItems = useCallback(
    (tab: ProjectTab | null): ContextMenuItem[] => {
      if (!tab) return [];

      const { handleRevealInFolder } = useFileSystemStore.getState();

      const items: ContextMenuItem[] = [
        {
          id: "copy-path",
          label: "Copy Path",
          icon: <Copy />,
          onClick: async () => {
            await writeText(tab.path);
          },
        },
        {
          id: "reveal",
          label: "Reveal in Finder",
          icon: <FolderOpen />,
          onClick: () => {
            if (handleRevealInFolder) {
              handleRevealInFolder(tab.path);
            }
          },
        },
        {
          id: "select-icon",
          label: "Select Icon",
          icon: <Image />,
          onClick: () => {
            setIconPickerTab(tab);
          },
        },
        {
          id: "open-in-new-window",
          label: "Open in New Window",
          icon: <ArrowSquareOut weight="duotone" />,
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
        icon: <X weight="bold" />,
        onClick: () => {
          closeProject(tab.id);
        },
      });

      items.push({
        id: "close-others",
        label: "Close Other Projects",
        onClick: () => {
          projectTabs.forEach((t) => {
            if (t.id !== tab.id && projectTabs.length > 1) {
              closeProject(t.id);
            }
          });
        },
      });

      items.push({
        id: "close-right",
        label: "Close to Right",
        onClick: () => {
          const currentIndex = projectTabs.findIndex((t) => t.id === tab.id);
          if (currentIndex === -1) return;

          for (let i = projectTabs.length - 1; i > currentIndex; i--) {
            if (projectTabs.length > 1) {
              closeProject(projectTabs[i].id);
            }
          }
        },
      });

      items.push({
        id: "close-all",
        label: "Close All Projects",
        onClick: () => {
          // Close all tabs one by one
          // We copy the array to avoid issues while iterating and modifying
          const tabsToClose = [...projectTabs];
          tabsToClose.forEach((t) => closeProject(t.id));
        },
      });

      return items;
    },
    [projectTabs, closeProject],
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
              className="shrink-0 rounded-sm object-contain"
              style={{
                width: "var(--app-ui-font-size)",
                height: "var(--app-ui-font-size)",
              }}
            />
          ) : isRemote ? (
            <HardDrives weight="duotone" />
          ) : (
            <Folder weight="duotone" />
          ),
          label: <span className="max-w-32 truncate">{tab.name}</span>,
          className: cn(
            "px-6",
            isRemote &&
              (tab.isActive ? "bg-sky-500/15 text-sky-100" : "text-sky-200/85 hover:text-sky-100"),
            isSwitchingProject && "cursor-wait",
          ),
          style: { fontSize: "var(--ui-text-sm)" },
          action: (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={(event) => handleTabActionsClick(event, tab)}
              className={cn(
                "close-button -translate-y-1/2 absolute top-1/2 right-0.5 z-10 rounded-none border-0 text-text-lighter transition",
                "hover:bg-hover/60 hover:text-text",
                "opacity-0 group-hover/tab:opacity-100 group-focus-within/tab:opacity-100",
              )}
              tooltip="Project actions"
              aria-label="Project actions"
            >
              <DotsThreeVertical weight="bold" />
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
      <div className="group flex min-w-0 items-stretch">
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
          className="scrollbar-hidden min-w-0 overflow-x-auto overflow-y-hidden [overscroll-behavior-x:contain]"
        />
        <div className="w-0 overflow-hidden transition-[width,opacity] duration-150 ease-out group-hover:w-6 focus-within:w-6">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={handleAddProject}
            className="h-full w-6 rounded-none border-0 text-text-lighter opacity-0 transition-opacity duration-150 ease-out group-hover:opacity-100 focus-visible:opacity-100 hover:bg-hover/60 hover:text-text"
            tooltip="Open folder"
            aria-label="Open folder"
          >
            <Plus weight="bold" />
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

      {createPortal(
        <ProjectPickerDialog
          isOpen={isProjectPickerVisible}
          onClose={() => setIsProjectPickerVisible(false)}
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
