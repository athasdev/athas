import { useCallback, useEffect, useRef, useState, type UIEvent as ReactUIEvent } from "react";
import { flushSync } from "react-dom";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import {
  getProjectCarouselPageIndex,
  getProjectCarouselWindow,
} from "@/features/layout/utils/project-carousel";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { workspaceRuntimeRegistry } from "@/features/workspace/runtime/workspace-runtime-registry";
import { useWorkspaceTabsStore } from "@/features/window/stores/workspace-tabs.store";

const PROJECT_SCROLL_SETTLE_DELAY_MS = 120;

const waitForProjectCarouselPaint = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });

export function useActivityProjectCarousel({
  alignCurrentProject,
  isResizing,
}: {
  alignCurrentProject: () => void;
  isResizing: boolean;
}) {
  const enabled = !useSettingsStore((state) => state.settings.openFoldersInNewWindow);
  const projects = useWorkspaceTabsStore.use.projectTabs();
  const activeProject = projects.find((project) => project.isActive);
  const switchToProject = useFileSystemStore((state) => state.switchToProject);
  const isSwitchingProject = useFileSystemStore((state) => state.isSwitchingProject);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [loadingProjectId, setLoadingProjectId] = useState<string | null>(null);
  const isGestureSettlingRef = useRef(false);
  const scrollEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currentProject =
    projects.find((project) => project.id === currentProjectId) ?? activeProject;
  const currentProjectIndex = currentProject
    ? projects.findIndex((project) => project.id === currentProject.id)
    : -1;
  const carouselProjects = getProjectCarouselWindow(projects, currentProjectIndex);
  const renderedProjects = enabled ? carouselProjects : currentProject ? [currentProject] : [];

  useEffect(() => {
    if (isGestureSettlingRef.current) return;
    setCurrentProjectId(activeProject?.id ?? null);
  }, [activeProject?.id]);

  useEffect(() => {
    if (enabled) return;
    if (scrollEndTimerRef.current !== null) {
      clearTimeout(scrollEndTimerRef.current);
      scrollEndTimerRef.current = null;
    }
    isGestureSettlingRef.current = false;
    setCurrentProjectId(activeProject?.id ?? null);
    setLoadingProjectId(null);
  }, [activeProject?.id, enabled]);

  const activateProject = useCallback(
    async (projectId: string) => {
      if (
        !enabled ||
        isResizing ||
        isSwitchingProject ||
        isGestureSettlingRef.current ||
        projects.length === 0
      ) {
        return;
      }

      const targetProject = projects.find((project) => project.id === projectId);
      if (!targetProject || targetProject.id === currentProject?.id) {
        alignCurrentProject();
        return;
      }
      const targetWasReady = workspaceRuntimeRegistry.isWorkspaceReady(targetProject.id);

      isGestureSettlingRef.current = true;
      if (scrollEndTimerRef.current !== null) {
        clearTimeout(scrollEndTimerRef.current);
        scrollEndTimerRef.current = null;
      }
      flushSync(() => {
        setCurrentProjectId(targetProject.id);
        setLoadingProjectId(targetWasReady ? null : targetProject.id);
      });
      alignCurrentProject();

      try {
        await waitForProjectCarouselPaint();
        const switched = await switchToProject(targetProject.id);
        if (!switched) {
          flushSync(() => {
            setCurrentProjectId(activeProject?.id ?? null);
            setLoadingProjectId(null);
          });
          alignCurrentProject();
          return;
        }

        if (!targetWasReady) await waitForProjectCarouselPaint();
        setLoadingProjectId(null);
      } catch {
        flushSync(() => {
          setCurrentProjectId(activeProject?.id ?? null);
          setLoadingProjectId(null);
        });
        alignCurrentProject();
      } finally {
        isGestureSettlingRef.current = false;
      }
    },
    [
      activeProject?.id,
      alignCurrentProject,
      currentProject?.id,
      enabled,
      isResizing,
      isSwitchingProject,
      projects,
      switchToProject,
    ],
  );

  const selectProject = useCallback(
    (projectId: string) => {
      void activateProject(projectId);
    },
    [activateProject],
  );

  const handleScroll = useCallback(
    (event: ReactUIEvent<HTMLDivElement>) => {
      if (
        !enabled ||
        isResizing ||
        isSwitchingProject ||
        isGestureSettlingRef.current ||
        carouselProjects.length <= 1
      ) {
        return;
      }

      const container = event.currentTarget;
      if (scrollEndTimerRef.current !== null) clearTimeout(scrollEndTimerRef.current);
      scrollEndTimerRef.current = setTimeout(() => {
        scrollEndTimerRef.current = null;
        const pageIndex = getProjectCarouselPageIndex(
          container.scrollLeft,
          container.clientWidth,
          carouselProjects.length,
        );
        const targetProject = pageIndex === null ? undefined : carouselProjects[pageIndex];
        if (!targetProject || targetProject.id === currentProject?.id) {
          alignCurrentProject();
          return;
        }
        void activateProject(targetProject.id);
      }, PROJECT_SCROLL_SETTLE_DELAY_MS);
    },
    [
      activateProject,
      alignCurrentProject,
      carouselProjects,
      currentProject?.id,
      enabled,
      isResizing,
      isSwitchingProject,
    ],
  );

  useEffect(() => {
    return () => {
      if (scrollEndTimerRef.current !== null) clearTimeout(scrollEndTimerRef.current);
    };
  }, []);

  return {
    enabled,
    projects,
    currentProject,
    carouselProjects,
    renderedProjects,
    loadingProjectId,
    isSwitchingProject,
    selectProject,
    handleScroll,
  };
}
