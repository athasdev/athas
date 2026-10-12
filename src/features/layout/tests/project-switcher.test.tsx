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

const { ProjectSwitcher } = await import("../components/project-switcher");

let root: Root;
let container: HTMLDivElement;
let selected: string[];
let remoteRequests: number;

const project = (id: string, path: string, extra: Partial<ProjectTab> = {}): ProjectTab => ({
  id,
  name: path.split("/").filter(Boolean).pop() ?? id,
  path,
  isActive: false,
  lastOpened: 1,
  ...extra,
});

const WEB = project("web", "/code/web");
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

async function render(
  current: ProjectTab | null = WEB,
  projects: ProjectTab[] = [WEB, API, BOX],
  isSwitchingProject = false,
) {
  await act(async () =>
    root.render(
      <DialogServiceProvider>
        <ProjectSwitcher
          project={current ?? undefined}
          projects={projects}
          isSwitchingProject={isSwitchingProject}
          onSelectProject={(id) => selected.push(id)}
          onAddRemote={() => remoteRequests++}
        />
      </DialogServiceProvider>,
    ),
  );
  await flush();
}

const view = () => within(document.body);
const trigger = () => view().getByRole("button", { name: /^Switch project/ });
const menuItem = (name: string | RegExp) =>
  [...document.querySelectorAll<HTMLElement>('[role^="menuitem"]')].find((item) =>
    typeof name === "string"
      ? item.textContent?.trim() === name
      : name.test(item.textContent ?? ""),
  );
const rows = () =>
  [...document.querySelectorAll<HTMLElement>('[role^="menuitem"]')].map((item) =>
    item.textContent?.trim(),
  );

async function openMenu() {
  await act(async () => {
    fireEvent.click(trigger());
  });
  await flush();
}

async function click(element: HTMLElement | undefined) {
  if (!element) throw new Error("Missing element");
  await act(async () => {
    fireEvent.click(element);
  });
  await flush();
}

async function rowAction(name: string, action: string) {
  await click(view().getByRole("menuitem", { name: `More actions for ${name}` }));
  await click(menuItem(action));
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
  selected = [];
  remoteRequests = 0;
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

describe("project switcher", () => {
  it("names the current project and scans its folder for an icon once", async () => {
    await render();
    expect(trigger().getAttribute("aria-label")).toBe("Switch project. Current project: web");
    expect(trigger().getAttribute("title")).toBe("/code/web");
    expect(io.iconScans).toEqual(["/code/web"]);
    expect(trigger().querySelector("img")?.getAttribute("src")).toContain("favicon.svg");

    await render({ ...WEB, lastOpened: 2 });
    expect(io.iconScans).toEqual(["/code/web"]);

    await render(BOX);
    expect(trigger().getAttribute("aria-label")).toBe("Switch project. Current project: Build box");
    expect(io.iconScans).toEqual(["/code/web"]);
  });

  it("falls back to the open folder without a project tab", async () => {
    useProjectStore.setState({ rootFolderPath: "/code/scratch" });
    await render(null, []);
    expect(trigger().getAttribute("aria-label")).toBe("Switch project. Current project: scratch");
    expect(io.iconScans).toEqual([]);
  });

  it("lists projects and closed remote connections and switches projects", async () => {
    await render();
    await openMenu();
    expect(rows()).toEqual(
      expect.arrayContaining(["web", "api", "Build box", "Lab server", "Open project…"]),
    );
    expect(rows().filter((row) => row === "Build box")).toHaveLength(1);
    await click(menuItem("api"));
    expect(selected).toEqual(["api"]);
  });

  it("filters projects and remote connections by search", async () => {
    await render();
    await openMenu();
    const search = view().getByPlaceholderText("Search projects");
    await act(async () => {
      fireEvent.change(search, { target: { value: "lab" } });
    });
    await flush();
    expect(menuItem("web")).toBeUndefined();
    expect(menuItem("Lab server")).toBeDefined();
    await act(async () => {
      fireEvent.change(search, { target: { value: "zzz" } });
    });
    await flush();
    expect(view().getByText("No projects match")).toBeTruthy();
  });

  it("opens a folder or starts adding a remote from the footer", async () => {
    await render();
    await openMenu();
    await click(menuItem("Open project…"));
    expect(io.folderPicks).toBe(1);
    await openMenu();
    await click(menuItem("Add remote…"));
    expect(remoteRequests).toBe(1);
  });

  it("connects to a closed remote and asks for a password when needed", async () => {
    io.connectErrors = ["Authentication failed"];
    await render();
    await openMenu();
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
    await openMenu();
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
    await openMenu();
    await rowAction("api", "Remove from Athas…");
    expect(view().getByText(/Files on disk will not be deleted/)).toBeTruthy();
    await confirm();
    expect(io.closed).toEqual(["api"]);
    expect(useRecentFoldersStore.getState().recentFolders).toEqual([]);
    expect(success).toHaveBeenCalledWith("Removed “api” from Athas.");
  });

  it("removes a remote project and its saved connection", async () => {
    await render();
    await openMenu();
    await rowAction("Build box", "Remove from Athas…");
    expect(view().getByText(/Remote files will not be deleted/)).toBeTruthy();
    await confirm();
    expect(io.closed).toEqual(["box"]);
    expect(io.connections.map((connection) => connection.id)).toEqual(["lab"]);
  });

  it("keeps a project when removal is cancelled or the project refuses to close", async () => {
    await render(WEB, [WEB, project("stuck", "/code/stuck")]);
    await openMenu();
    await rowAction("stuck", "Remove from Athas…");
    await confirm("Cancel");
    expect(io.closed).toEqual([]);

    await openMenu();
    await rowAction("stuck", "Remove from Athas…");
    await confirm();
    expect(io.closed).toEqual(["stuck"]);
  });

  it("removes a closed remote connection", async () => {
    await render();
    await openMenu();
    await rowAction("Lab server", "Remove from Athas…");
    await confirm();
    expect(io.connections.map((connection) => connection.id)).toEqual(["box"]);
  });

  it("picks an icon for a local project", async () => {
    await render();
    await openMenu();
    await rowAction("api", "Select project icon…");
    expect(view().getByRole("dialog", { name: "Icon for /code/api" })).toBeTruthy();
    await click(view().getByRole("button", { name: "Done" }));
    expect(view().queryByRole("dialog", { name: "Icon for /code/api" })).toBeNull();
  });
});
