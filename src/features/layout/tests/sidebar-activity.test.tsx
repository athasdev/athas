// @vitest-environment jsdom
import { act, useEffect, useState, useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { SidebarPane } from "../components/sidebar/sidebar-pane";

const state = vi.hoisted(() => ({
  activeSidebarView: "files",
  isGitViewActive: false,
  isGitHubPRsViewActive: false,
  starts: vi.fn(),
  stops: vi.fn(),
}));

let externalValue = 0;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

function Panel() {
  const [count, setCount] = useState(0);
  const value = useSyncExternalStore(subscribe, () => externalValue);
  useEffect(() => {
    state.starts();
    return () => state.stops();
  }, []);
  return (
    <button onClick={() => setCount((previous) => previous + 1)}>
      {count}:{value}
    </button>
  );
}

vi.mock("@/features/file-explorer/components/file-explorer-pane", () => ({
  FileExplorerPane: () => <Panel />,
}));
vi.mock("@/features/collaboration/components/collaboration-sidebar", () => ({
  CollaborationSidebarView: () => <Panel />,
}));
vi.mock("@/features/database/components/database-sidebar", () => ({
  DatabaseSidebar: () => <Panel />,
}));
vi.mock("@/features/docker/components/docker-sidebar", () => ({ DockerSidebar: () => null }));
vi.mock("@/features/git/components/git-view", () => ({ default: () => <Panel /> }));
vi.mock("@/features/github/components/github-prs-view", () => ({ default: () => null }));
vi.mock("@/features/outline/components/outline-sidebar", () => ({ OutlineSidebar: () => null }));
vi.mock("@/features/views/components/views-sidebar", () => ({ ViewsSidebar: () => null }));
vi.mock("@/features/workspace/team/components/workspace-sidebar", () => ({
  WorkspaceSidebar: () => <Panel />,
}));
vi.mock("@/features/file-system/stores/file-system.store", () => ({
  useFileSystemStore: {
    use: { handleFileSelect: () => vi.fn(), rootFolderPath: () => "/workspace" },
  },
}));
vi.mock("@/features/window/stores/ui-state.store", () => ({
  useUIState: (select: (value: typeof state) => unknown) => select(state),
}));
vi.mock("@/features/settings/stores/settings.store", () => ({
  useSettingsStore: (select: (value: unknown) => unknown) =>
    select({
      settings: {
        coreFeatures: { git: true, github: true, docker: true, teamCollaboration: true },
      },
    }),
}));
vi.mock("@/features/window/stores/auth.store", () => ({ useAuthStore: () => true }));
vi.mock("@/extensions/ui/hooks/use-extension-views", () => ({
  useExtensionViews: () => new Map(),
}));

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  state.activeSidebarView = "files";
  externalValue = 0;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("sidebar activity", () => {
  it.each(["files", "workspaces", "databases"])(
    "pauses collapsed %s and restores its state with current store data",
    async (view) => {
      state.activeSidebarView = view;
      await act(async () => root.render(<SidebarPane visible />));
      await act(async () => container.querySelector("button")!.click());
      expect(container.textContent).toBe("1:0");
      await act(async () => root.render(<SidebarPane visible={false} />));
      expect(state.stops).toHaveBeenCalledOnce();
      expect(listeners.size).toBe(0);
      await act(async () => {
        externalValue = 9;
        listeners.forEach((listener) => listener());
      });
      await act(async () => root.render(<SidebarPane visible />));
      expect(container.textContent).toBe("1:9");
      expect(state.starts).toHaveBeenCalledTimes(2);
    },
  );

  it.each(["collaboration", "git"])(
    "keeps %s sessions and command listeners alive while collapsed",
    async (view) => {
      state.activeSidebarView = view;
      await act(async () => root.render(<SidebarPane visible />));
      await act(async () => root.render(<SidebarPane visible={false} />));
      expect(state.stops).not.toHaveBeenCalled();
      expect(listeners.size).toBe(1);
    },
  );
});
