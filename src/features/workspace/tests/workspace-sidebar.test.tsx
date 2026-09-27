// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { WorkspaceSidebar } from "../team/components/workspace-sidebar";
import { openWorkspaceManagement } from "../team/services/open-workspace-management";
import { useWorkspaceManagementStore } from "../team/stores/workspace-management.store";

const mocks = vi.hoisted(() => ({
  openContent: vi.fn(),
  openFolder: vi.fn(),
  setActiveView: vi.fn(),
  setIsSidebarVisible: vi.fn(),
  readTeamWorkspaceContent: vi.fn(),
  buffers: [{ id: "editor", type: "editor" }],
  activeBufferId: "editor",
}));
vi.mock("@/features/editor/stores/buffer.store", () => ({
  useBufferStore: Object.assign((select: (state: typeof mocks) => unknown) => select(mocks), {
    getState: () => ({ actions: { openContent: mocks.openContent } }),
  }),
}));
vi.mock("@/features/file-system/stores/file-system.store", () => ({
  useFileSystemStore: Object.assign(
    (select: (state: { rootFolderPath: string }) => unknown) =>
      select({ rootFolderPath: "/active" }),
    { getState: () => ({ rootFolderPath: "/active" }) },
  ),
}));
vi.mock("@/features/window/stores/workspace-tabs.store", () => ({
  useWorkspaceTabsStore: { use: { projectTabs: () => [] } },
}));
vi.mock("@/features/file-system/controllers/platform", () => ({ openFolder: mocks.openFolder }));
vi.mock("@/features/window/stores/auth.store", () => ({ useAuthStore: () => false }));
vi.mock("@/features/window/stores/ui-state.store", () => ({
  useUIState: { getState: () => mocks },
}));
vi.mock("../team/services/team-workspace-service", () => ({
  readTeamWorkspaceContent: mocks.readTeamWorkspaceContent,
  saveTeamWorkspace: vi.fn(),
}));

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  mocks.readTeamWorkspaceContent.mockResolvedValue(null);
  useWorkspaceManagementStore.setState({
    roots: ["/selected"],
    selectedRoot: "/selected",
    drafts: {},
    bindings: {},
    section: "overview",
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const button = (label: string) =>
  [...container.querySelectorAll("button")].find(
    (element) => element.textContent === label || element.getAttribute("aria-label") === label,
  )!;

describe("workspace sidebar navigation", () => {
  it("opens a section for the selected workspace without replacing its unsaved draft", async () => {
    await useWorkspaceManagementStore.getState().actions.load("/selected");
    const config = useWorkspaceManagementStore.getState().drafts["/selected"]!.config;
    useWorkspaceManagementStore
      .getState()
      .actions.update("/selected", { ...config, name: "Unsaved name" });
    await act(async () => root.render(<WorkspaceSidebar />));
    await act(async () => button("Tasks").click());
    expect(mocks.openContent).toHaveBeenCalledWith({ type: "workspaces" });
    expect(useWorkspaceManagementStore.getState().section).toBe("tasks");
    expect(useWorkspaceManagementStore.getState().selectedRoot).toBe("/selected");
    expect(useWorkspaceManagementStore.getState().drafts["/selected"]!.config.name).toBe(
      "Unsaved name",
    );
    expect(mocks.readTeamWorkspaceContent).toHaveBeenCalledTimes(1);
  });

  it("opens a newly added workspace in the details area", async () => {
    mocks.openFolder.mockResolvedValue("/new");
    await act(async () => root.render(<WorkspaceSidebar />));
    await act(async () => button("Add workspace").click());
    expect(useWorkspaceManagementStore.getState().selectedRoot).toBe("/new");
    expect(mocks.openContent).toHaveBeenCalledWith({ type: "workspaces" });
  });

  it("shows the standard sidebar when management is opened from a command", () => {
    openWorkspaceManagement();
    expect(mocks.setActiveView).toHaveBeenCalledWith("workspaces");
    expect(mocks.setIsSidebarVisible).toHaveBeenCalledWith(true);
    expect(mocks.openContent).toHaveBeenCalledWith({ type: "workspaces" });
    expect(useWorkspaceManagementStore.getState().selectedRoot).toBe("/active");
  });
});
