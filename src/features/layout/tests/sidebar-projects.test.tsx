// @vitest-environment jsdom
import { fireEvent, within } from "@testing-library/dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { useRecentFoldersStore } from "@/features/file-system/stores/recent-folders.store";
import { connectionStore } from "@/features/remote/stores/remote-connection.store";
import type { RemoteConnection } from "@/features/remote/types/remote.types";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import type { ProjectTab } from "@/features/workspace/stores/workspace-tabs.store";
import { useProjectStore } from "@/features/workspace/stores/project.store";
import { DialogServiceProvider } from "@/ui/dialog";

const io = vi.hoisted(() => {
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      invoke: (cmd: string) => Promise.resolve(cmd.includes("get_all") ? [] : null),
      transformCallback: () => 1,
      convertFileSrc: (path: string) => `asset://localhost${path}`,
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    },
  });
  return {
    connections: [] as RemoteConnection[],
    connects: [] as Array<[string, string | undefined]>,
    connectErrors: [] as string[],
    icons: new Map<string, string>(),
    iconScans: [] as string[],
    closed: [] as string[],
    folderPicks: 0,
    started: [] as string[],
    dashboards: [] as string[],
    shownTools: [] as string[],
    shownProjects: [] as string[],
    pickerSteps: [] as string[],
    status: { attention: null as string | null, working: false },
  };
});

vi.mock("@/features/workspace/services/remote-connection-actions", () => ({
  loadRemoteConnections: async () => io.connections.map((connection) => ({ ...connection })),
  connectRemoteConnection: async (connection: RemoteConnection, password?: string) => {
    io.connects.push([connection.id, password]);
    const error = io.connectErrors.shift();
    if (error) throw new Error(error);
  },
}));
vi.mock("@/features/workspace/project-icons/services/project-icons", () => ({
  findBestProjectIcon: async (path: string) => {
    io.iconScans.push(path);
    const icon = io.icons.get(path);
    return icon ? { path: icon } : null;
  },
}));
vi.mock("@/features/workspace/project-icons/components/project-icon-picker", () => ({
  default: ({ projectPath, onClose }: { projectPath: string; onClose: () => void }) => (
    <div role="dialog" aria-label={`Icon for ${projectPath}`}>
      <button type="button" onClick={onClose}>
        Done
      </button>
    </div>
  ),
}));

vi.mock("@/features/ai/hooks/use-sidebar-sessions", () => ({
  useSidebarSessions: () => ({
    pinned: [{ id: "c2", title: "Release notes" }],
    byProject: {
      web: { projectId: "web", chats: [{ id: "c1", title: "Fix login" }], cloudRuns: [] },
    },
    chats: [],
    otherChats: [],
    otherRuns: [],
    archived: [],
  }),
}));
vi.mock("@/features/ai/components/sidebar/workbench-sessions", () => ({
  ProjectSessionList: ({ sessions }: { sessions?: { chats: { id: string; title: string }[] } }) => (
    <ul>
      {sessions?.chats.map((chat) => (
        <li key={chat.id}>{chat.title}</li>
      ))}
    </ul>
  ),
  PinnedSessions: ({ chats }: { chats: { id: string; title: string }[] }) => (
    <section aria-label="Pinned sessions">{chats.map((chat) => chat.title)}</section>
  ),
  ChatSessions: () => null,
  OtherCloudSessions: () => null,
  ArchivedSessions: () => null,
}));
vi.mock("@/features/ai/hooks/use-outside-agent-sessions", () => ({
  useOutsideAgentSessions: () => [],
}));
vi.mock("@/features/ai/hooks/use-project-agent-status", () => ({
  useProjectAgentStatus: () => io.status,
}));
vi.mock("@/features/ai/services/agent-project-navigation", () => ({
  startAgentInProject: (id: string) => io.started.push(id),
  openProjectDashboard: (id: string) => io.dashboards.push(id),
}));
vi.mock("@/features/layout/services/project-view", () => ({
  activateProject: async () => true,
  showProjectView: async (id: string) => io.shownProjects.push(id),
}));
vi.mock("@/features/layout/services/project-tools", () => ({
  showProjectTool: (view: string) => io.shownTools.push(view),
}));
vi.mock("../components/dock/project-tools", () => ({
  useProjectTools: () => [
    { view: "files", paneId: "view:files", title: "Files", icon: null, render: () => null },
    { view: "git", paneId: "view:git", title: "Source Control", icon: null, render: () => null },
  ],
}));

const { SidebarProjects } = await import("../components/sidebar/sidebar-projects");
const { useWorkspaceTabsStore } = await import("@/features/workspace/stores/workspace-tabs.store");
const { useUIState } = await import("@/features/layout/stores/ui-state.store");
const { useWorkbenchSidebarStore } =
  await import("@/features/layout/stores/workbench-sidebar.store");

let root: Root;
let container: HTMLDivElement;

const project = (id: string, path: string, extra: Partial<ProjectTab> = {}): ProjectTab => ({
  id,
  name: path.split("/").filter(Boolean).pop() ?? id,
  path,
  isActive: false,
  lastOpened: 1,
  ...extra,
});

const WEB = project("web", "/code/web", { isActive: true });
const API = project("api", "/code/api", { customIcon: "/code/api/logo.png" });
const BOX = project("box", "remote://box/", { name: "Build box" });

const remote = (id: string, name: string): RemoteConnection => ({
  id,
  name,
  host: `${id}.example.test`,
  port: 22,
  username: "dev",
  type: "ssh",
  isConnected: false,
});

async function flush() {
  await act(async () => {
    for (let index = 0; index < 5; index++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function render(projects: ProjectTab[] = [WEB, API, BOX]) {
  useWorkspaceTabsStore.setState({ projectTabs: projects });
  await act(async () =>
    root.render(
      <DialogServiceProvider>
        <SidebarProjects />
      </DialogServiceProvider>,
    ),
  );
  await flush();
}

const view = () => within(document.body);
const group = (id: string) => document.querySelector<HTMLElement>(`[data-project-id="${id}"]`);
const menuItem = (name: string | RegExp) =>
  [...document.querySelectorAll<HTMLElement>('[role^="menuitem"]')].find((item) =>
    typeof name === "string"
      ? item.textContent?.trim() === name
      : name.test(item.textContent ?? ""),
  );

async function click(element: HTMLElement | null | undefined) {
  if (!element) throw new Error("Missing element");
  await act(async () => {
    fireEvent.click(element);
  });
  await flush();
}

async function projectAction(name: string, action: string) {
  await click(view().getByRole("button", { name: `Actions for ${name}` }));
  await click(menuItem(action));
}

async function addProjectMenu() {
  await click(view().getByRole("button", { name: "Add project" }));
}

async function confirm(label = "Remove") {
  await click(view().getByRole("button", { name: label }));
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  workspaceRuntimeRegistry.resetForTests();
  io.connections = [remote("box", "Build box"), remote("lab", "Lab server")];
  io.connects = [];
  io.connectErrors = [];
  io.icons = new Map([["/code/web", "/code/web/favicon.svg"]]);
  io.iconScans = [];
  io.closed = [];
  io.folderPicks = 0;
  io.started = [];
  io.dashboards = [];
  io.shownTools = [];
  io.shownProjects = [];
  io.status = { attention: null, working: false };
  useWorkbenchSidebarStore.setState({ collapsedProjects: {} });
  useProjectStore.setState({ rootFolderPath: "/code/web" });
  useFileSystemStore.setState({
    closeProject: async (id: string) => {
      io.closed.push(id);
      return id !== "stuck";
    },
    handleOpenFolder: async () => {
      io.folderPicks++;
      return true;
    },
  } as never);
  vi.spyOn(connectionStore, "deleteConnection").mockImplementation(async (id: string) => {
    io.connections = io.connections.filter((connection) => connection.id !== id);
  });
  Element.prototype.getAnimations = () => [];
  Element.prototype.scrollIntoView = () => {};
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("sidebar projects", () => {
  it("groups each open project's sessions under it and marks the active project", async () => {
    await render();
    expect(group("web")?.dataset.activeProject).toBe("true");
    expect(group("api")?.dataset.activeProject).toBeUndefined();
    expect(group("web")?.textContent).toContain("Fix login");
    expect(group("api")?.textContent).toContain("New session");
    expect(group("web")?.querySelector("img")?.getAttribute("src")).toContain("favicon.svg");
    expect(io.iconScans).toEqual(["/code/web"]);
  });

  it("lists pinned sessions above the projects, not inside them", async () => {
    await render();
    const pinned = view().getByRole("region", { name: "Pinned sessions" });
    const projects = view().getByRole("region", { name: "Projects" });
    expect(pinned.textContent).toContain("Release notes");
    expect(group("web")?.textContent).not.toContain("Release notes");
    expect(
      pinned.compareDocumentPosition(projects) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("folds a project to its header, which then shows a session at work", async () => {
    io.status = { attention: null, working: true };
    await render();
    await click(within(group("web")!).getByRole("button", { name: /^web/ }));
    expect(group("web")?.textContent).not.toContain("Fix login");
    expect(within(group("web")!).getByRole("status")).toBeTruthy();
    expect(useWorkbenchSidebarStore.getState().collapsedProjects).toEqual({ web: true });
  });

  it("opens the project dashboard from its name and folds it from the rest of its row", async () => {
    await render();
    const header = within(group("web")!).getByRole("button", { name: /^web/ });
    await click(header.querySelector<HTMLElement>("[data-project-name]")!);
    expect(io.dashboards).toEqual(["web"]);
    expect(useWorkbenchSidebarStore.getState().collapsedProjects).toEqual({});

    await click(header);
    expect(io.dashboards).toEqual(["web"]);
    expect(useWorkbenchSidebarStore.getState().collapsedProjects).toEqual({ web: true });

    await projectAction("api", "Open dashboard");
    expect(io.dashboards).toEqual(["web", "api"]);
  });

  it("starts a session in the project it is asked from", async () => {
    await render();
    await click(view().getByRole("button", { name: "New session in api" }));
    expect(io.started).toEqual(["api"]);
  });

  it("opens the project's own view and its tools from the project menu", async () => {
    await render();
    await projectAction("api", "Show project files");
    expect(io.shownProjects).toEqual(["api"]);
    await click(view().getByRole("button", { name: "Actions for web" }));
    await click(menuItem("Project tools"));
    await click(menuItem("Source Control"));
    expect(io.shownTools).toEqual(["git"]);
  });

  it("opens a folder, adds a remote and lists saved remotes that are not open", async () => {
    const openProjectPicker = vi.fn();
    useUIState.setState({ openProjectPicker } as never);
    await render();
    await addProjectMenu();
    expect(menuItem("Lab server")).toBeDefined();
    expect(menuItem("Build box")).toBeUndefined();
    await click(menuItem("Open project…"));
    expect(io.folderPicks).toBe(1);
    await addProjectMenu();
    await click(menuItem("Add remote…"));
    expect(openProjectPicker).toHaveBeenCalledWith("addRemote");
  });

  it("connects to a saved remote and asks for a password when needed", async () => {
    io.connectErrors = ["Authentication failed"];
    await render();
    await addProjectMenu();
    await click(menuItem("Lab server"));
    expect(io.connects).toEqual([["lab", undefined]]);
    const password = view().getByPlaceholderText("Enter password");
    await act(async () => {
      fireEvent.change(password, { target: { value: "hunter2" } });
    });
    await click(view().getByRole("button", { name: "Connect" }));
    expect(io.connects).toEqual([
      ["lab", undefined],
      ["lab", "hunter2"],
    ]);
  });

  it("reports a remote that cannot be reached", async () => {
    const error = vi.spyOn(toast, "error").mockImplementation(() => 1);
    io.connectErrors = ["Connection refused"];
    await render();
    await addProjectMenu();
    await click(menuItem("Lab server"));
    expect(error).toHaveBeenCalledTimes(1);
    expect(view().queryByPlaceholderText("Enter password")).toBeNull();
  });

  it("removes a local project after confirmation and forgets it as recent", async () => {
    const success = vi.spyOn(toast, "success").mockImplementation(() => 1);
    useRecentFoldersStore.setState({
      recentFolders: [{ name: "api", path: "/code/api", lastOpened: "now" }],
    } as never);
    await render();
    await projectAction("api", "Remove from Athas…");
    expect(view().getByText(/Files on disk will not be deleted/)).toBeTruthy();
    await confirm();
    expect(io.closed).toEqual(["api"]);
    expect(useRecentFoldersStore.getState().recentFolders).toEqual([]);
    expect(success).toHaveBeenCalledWith("Removed “api” from Athas.");
  });

  it("removes a remote project and its saved connection", async () => {
    await render();
    await projectAction("Build box", "Remove from Athas…");
    expect(view().getByText(/Remote files will not be deleted/)).toBeTruthy();
    await confirm();
    expect(io.closed).toEqual(["box"]);
    expect(io.connections.map((connection) => connection.id)).toEqual(["lab"]);
  });

  it("keeps a project when removal is cancelled or the project refuses to close", async () => {
    await render([WEB, project("stuck", "/code/stuck")]);
    await projectAction("stuck", "Remove from Athas…");
    await confirm("Cancel");
    expect(io.closed).toEqual([]);

    await projectAction("stuck", "Remove from Athas…");
    await confirm();
    expect(io.closed).toEqual(["stuck"]);
  });

  it("closes a project without removing it", async () => {
    await render();
    await projectAction("api", "Close project");
    expect(io.closed).toEqual(["api"]);
  });

  it("removes a saved remote connection", async () => {
    await render();
    await addProjectMenu();
    await click(view().getByRole("button", { name: "Remove Lab server from Athas" }));
    await confirm();
    expect(io.connections.map((connection) => connection.id)).toEqual(["box"]);
  });

  it("picks an icon for a local project", async () => {
    await render();
    await projectAction("api", "Select project icon…");
    expect(view().getByRole("dialog", { name: "Icon for /code/api" })).toBeTruthy();
    await click(view().getByRole("button", { name: "Done" }));
    expect(view().queryByRole("dialog", { name: "Icon for /code/api" })).toBeNull();
  });
});
