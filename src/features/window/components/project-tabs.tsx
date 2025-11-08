import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Copy, Folder, FolderOpen, Plus, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import { useContextMenu } from "@/hooks/use-context-menu";
import type { ProjectTab } from "@/stores/workspace-tabs-store";
import { useWorkspaceTabsStore } from "@/stores/workspace-tabs-store";
import type { ContextMenuItem } from "@/ui/context-menu";
import { ContextMenu } from "@/ui/context-menu";
import { cn } from "@/utils/cn";

const DRAG_THRESHOLD = 5;

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
  const { handleOpenFolder, switchToProject, closeProject } = useFileSystemStore();

  const tabBarRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
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
    (e: React.MouseEvent, index: number, tab: ProjectTab) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest("button.close-button")) {
        return;
      }

      if (!tab.isActive) {
        switchToProject(tab.id);
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

  const handleCloseTab = async (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation();
    await closeProject(projectId);
  };

  const handleAddProject = async () => {
    await handleOpenFolder();
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
          icon: <Copy size={11} />,
          onClick: async () => {
            await writeText(tab.path);
          },
        },
        {
          id: "reveal",
          label: "Reveal in Finder",
          icon: <FolderOpen size={11} />,
          onClick: () => {
            if (handleRevealInFolder) {
              handleRevealInFolder(tab.path);
            }
          },
        },
        {
          id: "separator-1",
          label: "",
          separator: true,
          onClick: () => {},
        },
      ];

      // Only show Close Project if there's more than one tab
      if (projectTabs.length > 1) {
        items.push({
          id: "close-project",
          label: "Close Project",
          icon: <X size={11} />,
          onClick: () => {
            closeProject(tab.id);
          },
        });
      }

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

      // Only show Close All if there's more than one tab
      if (projectTabs.length > 1) {
        items.push({
          id: "close-all",
          label: "Close All Projects",
          onClick: () => {
            for (let i = projectTabs.length - 1; i >= 1; i--) {
              closeProject(projectTabs[i].id);
            }
          },
        });
      }

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
      <div ref={tabBarRef} className="flex items-center gap-1 px-2">
        {projectTabs.map((tab: ProjectTab, index: number) => {
          const isDraggedTab = isDragging && draggedIndex === index;
          const showDropIndicatorBefore =
            isDragging && dropTargetIndex === index && draggedIndex !== index;

          return (
            <div key={tab.id} className="relative flex items-center">
              {showDropIndicatorBefore && (
                <div className="absolute top-1 bottom-1 left-0 z-20 w-0.5 bg-accent" />
              )}
              <button
                ref={(el) => {
                  tabRefs.current[index] = el;
                }}
                onMouseDown={(e) => handleMouseDown(e, index, tab)}
                onContextMenu={(e) => contextMenu.open(e, tab)}
                className={cn(
                  "group relative flex items-center gap-1.5 rounded px-2 py-0.5 text-xs transition-colors",
                  tab.isActive
                    ? "bg-selected text-text"
                    : "text-text-lighter hover:bg-hover hover:text-text",
                  isDraggedTab && "opacity-30",
                )}
                title={tab.path}
              >
                <Folder size={12} />
                <span className="max-w-32 truncate">{tab.name}</span>
                {projectTabs.length > 1 && (
                  <button
                    onClick={(e) => handleCloseTab(e, tab.id)}
                    className={cn(
                      "close-button -translate-y-1/2 absolute top-1/2 right-0.5 flex size-4 items-center justify-center rounded bg-selected transition-opacity",
                      "hover:bg-primary-bg hover:text-text",
                      "opacity-0 group-hover:opacity-100",
                    )}
                    title="Close project"
                    aria-label="Close project"
                  >
                    <X size={10} />
                  </button>
                )}
              </button>
            </div>
          );
        })}
        {isDragging && dropTargetIndex === projectTabs.length && (
          <div className="relative">
            <div className="absolute top-1 bottom-1 left-0 z-20 w-0.5 bg-accent" />
          </div>
        )}
        <button
          onClick={handleAddProject}
          className="flex size-6 shrink-0 items-center justify-center rounded text-text-lighter transition-colors hover:bg-hover hover:text-text"
          title="Open folder"
          aria-label="Open folder"
        >
          <Plus size={14} />
        </button>
      </div>

      <ContextMenu
        isOpen={contextMenu.isOpen}
        position={contextMenu.position}
        items={getContextMenuItems(contextMenu.data)}
        onClose={contextMenu.close}
      />
    </>
  );
};

export default ProjectTabs;
