import { convertFileSrc } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  Copy,
  EllipsisVertical,
  Folder,
  FolderOpen,
  Image,
  Plus,
  Server,
  SquareArrowOutUpRight,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import { useUIState } from "@/features/window/stores/ui-state-store";
import type { ProjectTab } from "@/features/window/stores/workspace-tabs-store";
import { useWorkspaceTabsStore } from "@/features/window/stores/workspace-tabs-store";
import { createAppWindow } from "@/features/window/utils/create-app-window";
import { Button } from "@/ui/button";
import { ContextMenu, useContextMenu, type ContextMenuItem } from "@/ui/context-menu";
import { Tab, TabsList } from "@/ui/tabs";
import { cn } from "@/utils/cn";
import ProjectIconPicker from "./project-icon-picker";
import ProjectPickerDialog from "./project-picker-dialog";

const DRAG_THRESHOLD = 5;

const isRemoteProjectTab = (tab: ProjectTab) => tab.path.startsWith("remote://");

interface TabPosition {
  index: number;
  left: number;
  right: number;
  width: number;
  center: number;
}

const ProjectTabs = () => {
  const projectTabs = useWorkspaceTabsStore.use.projectTabs();
  const { reorderProjectTabs } = useWorkspaceTabsStore.getState();
  const { switchToProject, closeProject } = useFileSystemStore();
  const isSwitchingProject = useFileSystemStore.use.isSwitchingProject();
  const { isProjectPickerVisible, setIsProjectPickerVisible } = useUIState();

  const tabBarRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<(HTMLDivElement | null)[]>([]);
  const dragStateRef = useRef({
    isDragging: false,
    draggedIndex: null as number | null,
    dropTargetIndex: null as number | null,
  });

  const [dragState, setDragState] = useState<{
    isDragging: boolean;
    draggedIndex: number | null;
    dropTargetIndex: number | null;
    startPosition: { x: number; y: number } | null;
    currentPosition: { x: number; y: number } | null;
    tabPositions: TabPosition[];
  }>({
    isDragging: false,
    draggedIndex: null,
    dropTargetIndex: null,
    startPosition: null,
    currentPosition: null,
    tabPositions: [],
  });

  const [iconPickerTab, setIconPickerTab] = useState<ProjectTab | null>(null);

  const contextMenu = useContextMenu<ProjectTab>();

  useEffect(() => {
    dragStateRef.current = {
      isDragging: dragState.isDragging,
      draggedIndex: dragState.draggedIndex,
      dropTargetIndex: dragState.dropTargetIndex,
    };
  }, [dragState.isDragging, dragState.draggedIndex, dragState.dropTargetIndex]);

  useEffect(() => {
    tabRefs.current = tabRefs.current.slice(0, projectTabs.length);
  }, [projectTabs.length]);

  const cacheTabPositions = useCallback((): TabPosition[] => {
    if (!tabBarRef.current) return [];
    const containerRect = tabBarRef.current.getBoundingClientRect();
    const positions: TabPosition[] = [];
    tabRefs.current.forEach((tab, index) => {
      if (tab) {
        const rect = tab.getBoundingClientRect();
        const left = rect.left - containerRect.left;
        const right = rect.right - containerRect.left;
        positions.push({
          index,
          left,
          right,
          width: rect.width,
          center: left + rect.width / 2,
        });
      }
    });
    return positions;
  }, []);

  const calculateDropTarget = (
    mouseX: number,
    draggedIndex: number,
    tabPositions: TabPosition[],
  ): number => {
    if (!tabBarRef.current || tabPositions.length === 0) {
      return draggedIndex;
    }

    const containerRect = tabBarRef.current.getBoundingClientRect();
    const relativeX = mouseX - containerRect.left;

    if (relativeX < tabPositions[0]?.left) {
      return 0;
    }
    if (relativeX > tabPositions[tabPositions.length - 1]?.right) {
      return tabPositions.length;
    }

    for (let i = 0; i < tabPositions.length; i++) {
      const pos = tabPositions[i];
      if (relativeX >= pos.left && relativeX <= pos.right) {
        const relativePositionInTab = (relativeX - pos.left) / pos.width;
        return relativePositionInTab < 0.5 ? i : i + 1;
      }
    }

    return draggedIndex;
  };

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      setDragState((prev) => {
        if (prev.draggedIndex === null || !prev.startPosition) return prev;

        const currentPosition = { x: e.clientX, y: e.clientY };
        const distance = Math.sqrt(
          (currentPosition.x - prev.startPosition.x) ** 2 +
            (currentPosition.y - prev.startPosition.y) ** 2,
        );

        if (!prev.isDragging && distance > DRAG_THRESHOLD) {
          const tabPositions = cacheTabPositions();
          return {
            ...prev,
            isDragging: true,
            currentPosition,
            tabPositions,
            dropTargetIndex: prev.draggedIndex,
          };
        }

        if (prev.isDragging) {
          const dropTarget = calculateDropTarget(e.clientX, prev.draggedIndex, prev.tabPositions);
          return {
            ...prev,
            currentPosition,
            dropTargetIndex: dropTarget,
          };
        }

        return { ...prev, currentPosition };
      });
    },
    [cacheTabPositions],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, index: number, _tab: ProjectTab) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest("button.close-button")) {
        return;
      }

      e.preventDefault();
      setDragState({
        isDragging: false,
        draggedIndex: index,
        dropTargetIndex: null,
        startPosition: { x: e.clientX, y: e.clientY },
        currentPosition: { x: e.clientX, y: e.clientY },
        tabPositions: [],
      });
    },
    [switchToProject],
  );

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

  const handleTabActionsClick = (e: React.MouseEvent, tab: ProjectTab) => {
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
          icon: <SquareArrowOutUpRight />,
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
        icon: <X />,
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

  useEffect(() => {
    if (dragState.draggedIndex === null) return;

    const handleGlobalMouseMove = (e: MouseEvent) => {
      handleMouseMove(e);
    };

    const handleGlobalMouseUp = () => {
      const { isDragging, draggedIndex, dropTargetIndex } = dragStateRef.current;

      if (
        isDragging &&
        draggedIndex !== null &&
        dropTargetIndex !== null &&
        draggedIndex !== dropTargetIndex
      ) {
        let adjustedDropTarget = dropTargetIndex;
        if (draggedIndex < dropTargetIndex) {
          adjustedDropTarget = dropTargetIndex - 1;
        }

        if (adjustedDropTarget !== draggedIndex) {
          reorderProjectTabs(draggedIndex, adjustedDropTarget);
        }
      }

      setDragState({
        isDragging: false,
        draggedIndex: null,
        dropTargetIndex: null,
        startPosition: null,
        currentPosition: null,
        tabPositions: [],
      });
    };

    document.addEventListener("mousemove", handleGlobalMouseMove);
    document.addEventListener("mouseup", handleGlobalMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleGlobalMouseMove);
      document.removeEventListener("mouseup", handleGlobalMouseUp);
    };
  }, [dragState.draggedIndex, reorderProjectTabs, handleMouseMove]);

  if (projectTabs.length === 0) {
    return null;
  }

  const { isDragging, draggedIndex, dropTargetIndex } = dragState;

  return (
    <>
      <TabsList ref={tabBarRef} variant="segmented" className="group">
        {projectTabs.map((tab: ProjectTab, index: number) => {
          const isRemote = isRemoteProjectTab(tab);
          const isDraggedTab = isDragging && draggedIndex === index;
          const showDropIndicatorBefore =
            isDragging && dropTargetIndex === index && draggedIndex !== index;

          return (
            <div key={tab.id} className="relative flex h-full items-stretch">
              {showDropIndicatorBefore && (
                <div className="absolute top-1 bottom-1 left-0 z-20 w-0.5 bg-accent" />
              )}
              <Tab
                role="tab"
                tabIndex={0}
                aria-selected={tab.isActive}
                isActive={tab.isActive}
                isDragged={isDraggedTab}
                size="xs"
                variant="segmented"
                labelPosition="start"
                ref={(el) => {
                  tabRefs.current[index] = el;
                }}
                onMouseDown={(e) => handleMouseDown(e, index, tab)}
                onContextMenu={(e) => contextMenu.open(e, tab)}
                onKeyDown={(event) => handleTabKeyDown(event, tab)}
                className={cn(
                  "px-6",
                  isRemote &&
                    (tab.isActive
                      ? "bg-sky-500/15 text-sky-100"
                      : "text-sky-200/85 hover:text-sky-100"),
                  isSwitchingProject && "cursor-wait",
                )}
                style={{ fontSize: "var(--ui-text-sm)" }}
                onClick={() => void handleTabClick(tab)}
                title={tab.path}
                action={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    onClick={(e) => handleTabActionsClick(e, tab)}
                    className={cn(
                      "close-button -translate-y-1/2 absolute top-1/2 right-0.5 z-10 rounded-none border-0 text-text-lighter transition",
                      "hover:bg-hover/60 hover:text-text",
                      "opacity-0 group-hover/tab:opacity-100 group-focus-within/tab:opacity-100",
                    )}
                    tooltip="Project actions"
                    aria-label="Project actions"
                  >
                    <EllipsisVertical />
                  </Button>
                }
              >
                {tab.customIcon ? (
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
                  <Server />
                ) : (
                  <Folder />
                )}
                <span className="max-w-32 truncate">{tab.name}</span>
              </Tab>
            </div>
          );
        })}
        {isDragging && dropTargetIndex === projectTabs.length && (
          <div className="relative">
            <div className="absolute top-1 bottom-1 left-0 z-20 w-0.5 bg-accent" />
          </div>
        )}
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
            <Plus />
          </Button>
        </div>
      </TabsList>

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
