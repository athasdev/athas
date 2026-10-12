// @vitest-environment jsdom
import { fireEvent, within } from "@testing-library/dom";
import { enableMapSet } from "immer";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { commands } from "@/bindings/commands";
import { useRecentFoldersStore } from "@/features/file-system/stores/recent-folders.store";
import type { RemoteConnection } from "@/features/remote/types/remote.types";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";

const picker = vi.hoisted(() => {
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      invoke: () => Promise.resolve(null),
      transformCallback: () => 1,
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    },
  });
  return {
    openFolder: vi.fn(),
    openWsl: vi.fn(),
    openRecent: vi.fn(),
    loadConnections: vi.fn(),
    connect: vi.fn(),
    saveAndConnect: vi.fn(),
    testConnection: vi.fn(),
    prompt: vi.fn(),
    pickFile: vi.fn(),
    toasts: [] as string[],
  };
});

vi.mock("@/features/file-system/stores/file-system.store", () => ({
  useFileSystemStore: (select: (state: unknown) => unknown) =>
    select({ handleOpenFolder: picker.openFolder, handleOpenWslProject: picker.openWsl }),
}));
vi.mock("@/features/file-system/services/open-recent-folder", () => ({
  openRecentFolder: picker.openRecent,
}));
vi.mock("@/features/workspace/services/remote-connection-actions", () => ({
  loadRemoteConnections: picker.loadConnections,
  connectRemoteConnection: picker.connect,
  saveAndConnectRemoteConnection: picker.saveAndConnect,
  testRemoteConnection: picker.testConnection,
}));
vi.mock("@/features/remote/services/remote-connection-events", () => ({
  listenForSshConnectionStatus: async () => () => {},
}));
vi.mock("@/utils/file-dialogs", () => ({ pickFile: picker.pickFile }));
vi.mock("@/utils/local-files", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/local-files")>()),
  getHomeDirectory: async () => "/home/me",
}));
vi.mock("@/ui/dialog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ui/dialog")>()),
  showPromptDialog: picker.prompt,
}));
vi.mock("sonner", () => {
  const record = (message: string) => picker.toasts.push(message);
  return { toast: Object.assign(record, { success: record, error: record, info: record }) };
});

const { default: ProjectPicker } = await import("../project-picker/components/project-picker");

enableMapSet();

const connection = (overrides: Partial<RemoteConnection> = {}): RemoteConnection => ({
  id: "prod",
  name: "Production",
  host: "prod.example.com",
  port: 22,
  username: "deploy",
  type: "ssh",
  isConnected: false,
  ...overrides,
});

let root: Root;
let container: HTMLDivElement;
const onClose = vi.fn();

async function flush() {
  await act(async () => {
    for (let index = 0; index < 4; index++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function render(props: Partial<Parameters<typeof ProjectPicker>[0]> = {}) {
  await act(async () => root.render(<ProjectPicker isOpen onClose={onClose} {...props} />));
  await flush();
}

const body = () => within(document.body);
const searchInput = () => body().getByPlaceholderText("Open project or remote connection");

async function click(element: Element) {
  await act(async () => {
    (element as HTMLElement).click();
  });
  await flush();
}

async function type(input: HTMLElement, value: string) {
  await act(async () => {
    fireEvent.change(input, { target: { value } });
  });
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  workspaceRuntimeRegistry.resetForTests();
  for (const fn of Object.values(picker)) if (typeof fn === "function") fn.mockReset();
  picker.toasts.length = 0;
  onClose.mockReset();
  picker.loadConnections.mockResolvedValue([connection()]);
  vi.spyOn(commands, "wslListDistributions").mockResolvedValue([
    { name: "Ubuntu", state: "Running", version: 2, is_default: true },
  ] as never);
  vi.spyOn(commands, "wslGetHomeDir").mockResolvedValue("/home/me" as never);
  useRecentFoldersStore.setState({
    recentFolders: [
      { name: "athas", path: "/code/athas", lastOpened: "today", pinned: true },
      { name: "old-site", path: "/code/old-site", lastOpened: "last year", missing: true },
    ],
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
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("project picker", () => {
  it("renders nothing while closed", async () => {
    await render({ isOpen: false });
    expect(document.body.textContent).toBe("");
  });

  it("lists recent projects, remote connections and WSL distributions", async () => {
    await render();
    expect(body().getByText("athas")).toBeTruthy();
    expect(body().getByText("Missing")).toBeTruthy();
    expect(body().getByText("Production")).toBeTruthy();
    expect(body().getByText("deploy@prod.example.com")).toBeTruthy();
    expect(body().getByText("Ubuntu")).toBeTruthy();
    expect(body().getByText("Default")).toBeTruthy();

    await type(searchInput(), "nothing");
    expect(body().getByText('No projects match "nothing".')).toBeTruthy();
    await type(searchInput(), "prod");
    expect(body().queryByText("athas")).toBeNull();
    expect(body().getByText("Production")).toBeTruthy();
  });

  it("opens a recent project with the keyboard", async () => {
    await render();
    await act(async () => {
      fireEvent.keyDown(searchInput(), { key: "ArrowDown" });
    });
    await act(async () => {
      fireEvent.keyDown(searchInput(), { key: "ArrowUp" });
    });
    await act(async () => {
      fireEvent.keyDown(searchInput(), { key: "Enter" });
    });
    await flush();
    expect(onClose).toHaveBeenCalled();
    expect(picker.openRecent).toHaveBeenCalledWith("/code/athas");
  });

  it("removes a recent project and every missing one", async () => {
    await render();
    await click(body().getByRole("button", { name: "Remove athas from recent projects" }));
    expect(useRecentFoldersStore.getState().recentFolders.map((folder) => folder.path)).toEqual([
      "/code/old-site",
    ]);
    expect(picker.toasts).toContain('Removed "athas" from recent projects.');

    await click(body().getByRole("button", { name: /Remove Missing/ }));
    expect(useRecentFoldersStore.getState().recentFolders).toEqual([]);
    expect(picker.toasts).toContain("Removed 1 missing project from recents.");
    expect(body().queryByRole("button", { name: /Remove Missing/ })).toBeNull();
  });

  it("opens a folder from the footer", async () => {
    await render();
    await click(body().getByRole("button", { name: "Open Folder" }));
    expect(onClose).toHaveBeenCalled();
    expect(picker.openFolder).toHaveBeenCalled();
  });

  it("connects to a saved remote and reports failures", async () => {
    picker.connect.mockResolvedValueOnce(undefined);
    await render();
    await click(body().getByText("Production"));
    expect(picker.connect).toHaveBeenCalledWith(connection(), undefined);
    expect(onClose).toHaveBeenCalled();

    onClose.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
    picker.connect.mockRejectedValueOnce(new Error("Connection refused"));
    await click(body().getByText("Production"));
    expect(body().getByText("Connection failed")).toBeTruthy();
    expect(picker.toasts.length).toBeGreaterThan(0);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("asks for a password when the server rejects the saved credentials", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    picker.connect.mockRejectedValueOnce(new Error("Authentication failed"));
    await render();
    await click(body().getByText("Production"));
    expect(body().getAllByText(/password/i).length).toBeGreaterThan(0);
  });

  it("opens a project inside a WSL distribution", async () => {
    picker.prompt.mockResolvedValueOnce("/home/me/app");
    await render();
    await click(body().getByText("Ubuntu"));
    expect(picker.prompt).toHaveBeenCalledWith(
      "Linux project path",
      expect.objectContaining({ title: "Open Ubuntu", defaultValue: "/home/me" }),
    );
    expect(picker.openWsl).toHaveBeenCalledWith("Ubuntu", "/home/me/app");
  });

  it("adds, tests and saves a remote connection", async () => {
    await render();
    await click(body().getByRole("button", { name: /Add Remote/ }));
    expect(body().getByText("Add Remote Connection", { selector: "span" })).toBeTruthy();

    await type(body().getByLabelText("Connection name"), "Staging");
    await type(body().getByLabelText("Host"), "staging.example.com");

    picker.testConnection.mockRejectedValueOnce(new Error("Host unreachable"));
    await click(body().getByRole("button", { name: "Test Connection" }));
    expect(body().getByText("Host unreachable")).toBeTruthy();

    picker.testConnection.mockResolvedValueOnce(undefined);
    await click(body().getByRole("button", { name: "Test Connection" }));
    expect(body().getByText("Connection successful.")).toBeTruthy();

    picker.pickFile.mockResolvedValueOnce("/home/me/.ssh/id_ed25519");
    const chooseKey = body()
      .getAllByRole("button")
      .find((button) =>
        /browse|choose/i.test(button.textContent ?? button.getAttribute("aria-label") ?? ""),
      );
    if (chooseKey) {
      await click(chooseKey);
      expect((body().getByPlaceholderText("~/.ssh/id_ed25519") as HTMLInputElement).value).toBe(
        "/home/me/.ssh/id_ed25519",
      );
    }

    picker.saveAndConnect.mockRejectedValueOnce(new Error("Permission denied (publickey)"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await click(body().getByRole("button", { name: "Save & Connect" }));
    expect(onClose).not.toHaveBeenCalled();

    picker.saveAndConnect.mockResolvedValueOnce(undefined);
    await click(body().getByRole("button", { name: "Save & Connect" }));
    expect(picker.saveAndConnect).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: "Staging", host: "staging.example.com", port: 22 }),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("goes back from the remote form to the project list", async () => {
    await render({ initialStep: "addRemote" });
    await click(body().getByRole("button", { name: "Back to projects" }));
    expect(searchInput()).toBeTruthy();
  });

  it("switches to the new project step", async () => {
    await render();
    await click(body().getByRole("button", { name: /New Project/ }));
    expect(body().queryByPlaceholderText("Open project or remote connection")).toBeNull();
    expect(body().getByText("Empty Project")).toBeTruthy();
    expect(body().getByText("Clone Repository")).toBeTruthy();
  });
});
