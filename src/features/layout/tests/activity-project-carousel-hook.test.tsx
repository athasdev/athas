// @vitest-environment jsdom
import { act, createElement, type UIEvent as ReactUIEvent } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.hoisted(() => {
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      invoke: vi.fn().mockResolvedValue([]),
      transformCallback: vi.fn(),
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    },
  });
});

vi.mock("@/features/settings/stores/settings.store", async () => {
  const { create } = await import("zustand");
  return {
    useSettingsStore: create(() => ({ settings: { openFoldersInNewWindow: false } })),
  };
});

vi.mock("@/features/file-system/stores/file-system.store", async () => {
  const { create } = await import("zustand");
  return {
    useFileSystemStore: create(() => ({
      isSwitchingProject: false,
      switchToProject: async () => true,
    })),
  };
});

import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import {
  useWorkspaceTabsStore,
  type ProjectTab,
} from "@/features/workspace/stores/workspace-tabs.store";
import { useActivityProjectCarousel } from "../hooks/use-activity-project-carousel";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

type CarouselResult = ReturnType<typeof useActivityProjectCarousel>;

function renderCarousel(alignCurrentProject: () => void) {
  const result = {} as { current: CarouselResult };
  function Probe() {
    result.current = useActivityProjectCarousel({ alignCurrentProject });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(Probe)));
  return { result, unmount: () => act(() => root.unmount()) };
}

function tab(id: string, isActive = false): ProjectTab {
  return { id, name: id, path: `/projects/${id}`, isActive, lastOpened: 0 };
}

function setProjects(activeId: string, ids = ["alpha", "beta", "gamma", "delta"]) {
  useWorkspaceTabsStore.setState({ projectTabs: ids.map((id) => tab(id, id === activeId)) });
}

function scrollEvent(scrollLeft: number, clientWidth = 100) {
  return { currentTarget: { scrollLeft, clientWidth } } as unknown as ReactUIEvent<HTMLDivElement>;
}

const fileSystemStore = useFileSystemStore as unknown as {
  setState: (state: Record<string, unknown>) => void;
};
const settingsStore = useSettingsStore as unknown as {
  setState: (state: Record<string, unknown>) => void;
};

async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(150);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    setTimeout(() => callback(0), 0),
  );
  workspaceRuntimeRegistry.resetForTests();
  settingsStore.setState({ settings: { openFoldersInNewWindow: false } });
  fileSystemStore.setState({ isSwitchingProject: false, switchToProject: async () => true });
  setProjects("beta");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  workspaceRuntimeRegistry.resetForTests();
});

describe("useActivityProjectCarousel", () => {
  it("renders the active project with its neighbors", () => {
    const { result, unmount } = renderCarousel(vi.fn());

    expect(result.current.enabled).toBe(true);
    expect(result.current.currentProject?.id).toBe("beta");
    expect(result.current.renderedProjects.map((project) => project.id)).toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
    unmount();
  });

  it("renders only the current project when folders open in new windows", () => {
    settingsStore.setState({ settings: { openFoldersInNewWindow: true } });
    const switchToProject = vi.fn(async () => true);
    fileSystemStore.setState({ switchToProject });
    const { result, unmount } = renderCarousel(vi.fn());

    expect(result.current.enabled).toBe(false);
    expect(result.current.renderedProjects.map((project) => project.id)).toEqual(["beta"]);

    act(() => result.current.selectProject("gamma"));
    expect(switchToProject).not.toHaveBeenCalled();
    unmount();
  });

  it("switches to a selected project and shows loading until it is painted", async () => {
    const switchToProject = vi.fn(async () => true);
    fileSystemStore.setState({ switchToProject });
    const align = vi.fn();
    const { result, unmount } = renderCarousel(align);

    act(() => result.current.selectProject("gamma"));

    expect(result.current.currentProject?.id).toBe("gamma");
    expect(result.current.loadingProjectId).toBe("gamma");
    expect(align).toHaveBeenCalledOnce();

    await flush();

    expect(switchToProject).toHaveBeenCalledWith("gamma");
    expect(result.current.loadingProjectId).toBeNull();
    expect(result.current.currentProject?.id).toBe("gamma");
    unmount();
  });

  it("skips the loading state for a workspace that is already ready", async () => {
    workspaceRuntimeRegistry.ensureWorkspace({ id: "gamma", name: "gamma" }, "ready");
    const { result, unmount } = renderCarousel(vi.fn());

    act(() => result.current.selectProject("gamma"));

    expect(result.current.loadingProjectId).toBeNull();
    await flush();
    unmount();
  });

  it("snaps back to the active project when switching is refused", async () => {
    fileSystemStore.setState({ switchToProject: vi.fn(async () => false) });
    const align = vi.fn();
    const { result, unmount } = renderCarousel(align);

    act(() => result.current.selectProject("gamma"));
    await flush();

    expect(result.current.currentProject?.id).toBe("beta");
    expect(result.current.loadingProjectId).toBeNull();
    expect(align).toHaveBeenCalledTimes(2);
    unmount();
  });

  it("snaps back to the active project when switching throws", async () => {
    fileSystemStore.setState({
      switchToProject: vi.fn(async () => {
        throw new Error("failed to open");
      }),
    });
    const align = vi.fn();
    const { result, unmount } = renderCarousel(align);

    act(() => result.current.selectProject("gamma"));
    await flush();

    expect(result.current.currentProject?.id).toBe("beta");
    expect(result.current.loadingProjectId).toBeNull();
    expect(align).toHaveBeenCalledTimes(2);
    unmount();
  });

  it("only realigns when selecting the current or an unknown project", () => {
    const switchToProject = vi.fn(async () => true);
    fileSystemStore.setState({ switchToProject });
    const align = vi.fn();
    const { result, unmount } = renderCarousel(align);

    act(() => result.current.selectProject("beta"));
    act(() => result.current.selectProject("missing"));

    expect(align).toHaveBeenCalledTimes(2);
    expect(switchToProject).not.toHaveBeenCalled();
    unmount();
  });

  it("ignores selections while a project switch is already running", () => {
    const switchToProject = vi.fn(async () => true);
    fileSystemStore.setState({ switchToProject, isSwitchingProject: true });
    const align = vi.fn();
    const { result, unmount } = renderCarousel(align);

    act(() => result.current.selectProject("gamma"));
    act(() => result.current.handleScroll(scrollEvent(200)));

    expect(align).not.toHaveBeenCalled();
    expect(switchToProject).not.toHaveBeenCalled();
    unmount();
  });

  it("activates the project under the scroll position once scrolling settles", async () => {
    const switchToProject = vi.fn(async () => true);
    fileSystemStore.setState({ switchToProject });
    const { result, unmount } = renderCarousel(vi.fn());

    act(() => result.current.handleScroll(scrollEvent(100)));
    act(() => result.current.handleScroll(scrollEvent(200)));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(119);
    });
    expect(switchToProject).not.toHaveBeenCalled();

    await flush();

    expect(switchToProject).toHaveBeenCalledOnce();
    expect(switchToProject).toHaveBeenCalledWith("gamma");
    unmount();
  });

  it("realigns instead of switching when the scroll settles on the current project", async () => {
    const switchToProject = vi.fn(async () => true);
    fileSystemStore.setState({ switchToProject });
    const align = vi.fn();
    const { result, unmount } = renderCarousel(align);

    act(() => result.current.handleScroll(scrollEvent(100)));
    await flush();

    expect(switchToProject).not.toHaveBeenCalled();
    expect(align).toHaveBeenCalledOnce();
    unmount();
  });

  it("does not react to scrolling with a single project", async () => {
    setProjects("alpha", ["alpha"]);
    const align = vi.fn();
    const { result, unmount } = renderCarousel(align);

    act(() => result.current.handleScroll(scrollEvent(0)));
    await flush();

    expect(align).not.toHaveBeenCalled();
    unmount();
  });

  it("follows the active project when it changes outside the carousel", () => {
    const { result, unmount } = renderCarousel(vi.fn());

    act(() => setProjects("delta"));

    expect(result.current.currentProject?.id).toBe("delta");
    expect(result.current.renderedProjects.map((project) => project.id)).toEqual([
      "gamma",
      "delta",
    ]);
    unmount();
  });

  it("cancels a pending scroll switch when the carousel is turned off", async () => {
    const switchToProject = vi.fn(async () => true);
    fileSystemStore.setState({ switchToProject });
    const { result, unmount } = renderCarousel(vi.fn());

    act(() => result.current.handleScroll(scrollEvent(200)));
    act(() => settingsStore.setState({ settings: { openFoldersInNewWindow: true } }));
    await flush();

    expect(switchToProject).not.toHaveBeenCalled();
    expect(result.current.currentProject?.id).toBe("beta");
    unmount();
  });
});
