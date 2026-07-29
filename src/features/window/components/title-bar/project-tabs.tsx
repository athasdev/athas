import { type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { restrictToHorizontalAxis } from "@dnd-kit/modifiers";
import { SortableContext, arrayMove, horizontalListSortingStrategy } from "@dnd-kit/sortable";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useCallback, useState } from "react";
import type { KeyboardEvent, MouseEvent } from "react";
import { createPortal } from "react-dom";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { getChromeNavigationIndex } from "@/features/layout/utils/chrome-keyboard";
import { useUIState } from "@/features/window/stores/ui-state.store";
import type { ProjectTab } from "@/features/window/stores/workspace-tabs.store";
import { useWorkspaceTabsStore } from "@/features/window/stores/workspace-tabs.store";
import { createAppWindow } from "@/features/window/utils/create-app-window";
import { Button } from "@/ui/button";
import { Dropdown, useDropdownMenu, type MenuItem } from "@/ui/dropdown";
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
import { SortableTab, Tab, TabDndContext, useTabDragClickGuard } from "@/ui/tab-bar";
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
  const contextMenu = useDropdownMenu<ProjectTab>();
  const projectTabIds = projectTabs.map((tab) => tab.id);
  const { getClickCapture, releaseClickSuppression, suppressNextClick } = useTabDragClickGuard();

  const handleTabClick = useCallback(
    async (tab: ProjectTab) => {
      if (isSwitchingProject || tab.isActive) return;
      await switchToProject(tab.id);
    },
    [isSwitchingProject, switchToProject],
  );

  const commitProjectOrder = useCallback(
    (orderedIds: string[]) => {
      const currentIds = projectTabs.map((tab) => tab.id);
      orderedIds.forEach((tabId, targetIndex) => {
        const currentIndex = currentIds.indexOf(tabId);
        if (currentIndex === -1 || currentIndex === targetIndex) return;

        reorderProjectTabs(currentIndex, targetIndex);
        currentIds.splice(currentIndex, 1);
        currentIds.splice(targetIndex, 0, tabId);
      });
    },
    [projectTabs, reorderProjectTabs],
  );

  const handleTabKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>, tab: ProjectTab) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        void handleTabClick(tab);
        return;
      }

      const currentIndex = projectTabs.findIndex((project) => project.id === tab.id);
      if (currentIndex < 0) return;
      const nextIndex = getChromeNavigationIndex(
        event.key,
        currentIndex,
        projectTabs.length,
        "horizontal",
      );
      if (nextIndex === null) return;

      if (event.shiftKey && !disableReorder && nextIndex !== currentIndex) {
        event.preventDefault();
        commitProjectOrder(arrayMove(projectTabIds, currentIndex, nextIndex));
        requestAnimationFrame(() => {
          const tabElements = event.currentTarget
            .closest("[data-title-bar-project-tabs='true']")
            ?.querySelectorAll<HTMLElement>("[role='tab']");
          tabElements?.[nextIndex]?.focus();
        });
        return;
      }

      const nextTab = projectTabs[nextIndex];
      if (!nextTab) return;

      event.preventDefault();
      const tabElements = event.currentTarget
        .closest("[data-title-bar-project-tabs='true']")
        ?.querySelectorAll<HTMLElement>("[role='tab']");
      tabElements?.[nextIndex]?.focus();
      void handleTabClick(nextTab);
    },
    [commitProjectOrder, disableReorder, handleTabClick, projectTabIds, projectTabs],
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
    (tab: ProjectTab | null): MenuItem[] => {
      if (!tab) return [];

      const { handleRevealInFolder } = useFileSystemStore.getState();

      const items: MenuItem[] = [
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

  const handleDragStart = (event: DragStartEvent) => {
    suppressNextClick(event.active.id);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    if (event.over && event.active.id !== event.over.id) {
      const oldIndex = projectTabIds.indexOf(String(event.active.id));
      const newIndex = projectTabIds.indexOf(String(event.over.id));
      if (oldIndex >= 0 && newIndex >= 0) {
        commitProjectOrder(arrayMove(projectTabIds, oldIndex, newIndex));
      }
    }

    releaseClickSuppression();
  };

  if (projectTabs.length === 0) {
    return null;
  }

  return (
    <>
      <div className="group flex min-w-0 items-center">
        <TabDndContext
          modifiers={[restrictToHorizontalAxis]}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={releaseClickSuppression}
        >
          <SortableContext items={projectTabIds} strategy={horizontalListSortingStrategy}>
            <div
              role="tablist"
              aria-label="Open projects"
              className="athas-title-project-tabs-list scrollbar-hidden flex min-w-0 items-center gap-(--athas-chrome-gap-tight) overflow-x-auto overflow-y-hidden bg-transparent [overscroll-behavior-x:contain]"
            >
              {projectTabs.map((tab) => {
                const isRemote = isRemoteProjectTab(tab);

                return (
                  <SortableTab
                    key={tab.id}
                    id={tab.id}
                    disabled={disableReorder}
                    onClickCapture={getClickCapture(tab.id)}
                  >
                    {({ isDragging }) => (
                      <Tab
                        role="tab"
                        tabIndex={tab.isActive ? 0 : -1}
                        aria-selected={tab.isActive}
                        aria-label={`${tab.name}, ${tab.path}`}
                        isActive={tab.isActive}
                        isDragged={isDragging}
                        onClick={() => void handleTabClick(tab)}
                        onContextMenu={(event) => contextMenu.open(event, tab)}
                        onKeyDown={(event) => handleTabKeyDown(event, tab)}
                        className={cn(
                          "h-(--athas-chrome-control-height) max-w-48 border border-transparent pr-7 pl-2",
                          isRemote &&
                            (tab.isActive
                              ? "bg-primary/15 text-primary"
                              : "text-primary/85 hover:text-primary"),
                          isSwitchingProject && "cursor-wait",
                        )}
                        action={
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={(event) => handleTabActionsClick(event, tab)}
                            className={cn(
                              "close-button -translate-y-1/2 absolute top-1/2 right-0.5 z-10 rounded-none border-0 text-subtle-foreground transition",
                              "hover:bg-accent/60 hover:text-foreground",
                              "opacity-0 group-hover/tab:opacity-100 group-focus-within/tab:opacity-100",
                            )}
                            tooltip="Project actions"
                            aria-label="Project actions"
                            size="icon-xs"
                          >
                            <CaretDownIcon />
                          </Button>
                        }
                      >
                        {tab.customIcon ? (
                          <img
                            src={convertFileSrc(tab.customIcon)}
                            alt=""
                            className="size-(--ui-text-chrome) shrink-0 rounded-md object-contain"
                          />
                        ) : isRemote ? (
                          <RemoteIcon />
                        ) : (
                          <FolderIcon />
                        )}
                        <span className="max-w-32 truncate">{tab.name}</span>
                      </Tab>
                    )}
                  </SortableTab>
                );
              })}
            </div>
          </SortableContext>
        </TabDndContext>
        <div className="ml-1 flex h-6 w-7 shrink-0 items-center">
          <Button
            type="button"
            variant="ghost"
            onClick={handleAddProject}
            className="athas-title-project-add-button border border-transparent text-subtle-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
            tooltip="Open folder"
            aria-label="Open folder"
            size="icon-xs"
          >
            <PlusIcon />
          </Button>
        </div>
      </div>

      {createPortal(
        <Dropdown
          isOpen={contextMenu.isOpen}
          point={contextMenu.position}
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
