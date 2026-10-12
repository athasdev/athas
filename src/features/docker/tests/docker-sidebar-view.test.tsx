// @vitest-environment jsdom
import { fireEvent, within } from "@testing-library/dom";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { enableMapSet } from "immer";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { useDebuggerStore } from "@/features/debugger/stores/debugger.store";
import { useSidebarStore } from "@/features/layout/stores/sidebar.store";
import { useProjectStore } from "@/features/workspace/stores/project.store";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import { onAppEvent } from "@/utils/app-events";
import { createTestQueryClient } from "@/utils/tests/query-test-client";
import type {
  DockerComposeProject,
  DockerContainer,
  DockerInventory,
  DockerProjectConfig,
} from "../types/docker.types";

const api = vi.hoisted(() => ({
  getDockerInventory: vi.fn(),
  getDockerComposeProject: vi.fn(),
  getDockerProjectConfig: vi.fn(),
  runDockerContainerAction: vi.fn(),
  startDockerContainerLogStream: vi.fn(),
  stopDockerContainerLogStream: vi.fn(),
  runDockerComposeAction: vi.fn(),
  buildDockerImage: vi.fn(),
  runDockerImage: vi.fn(),
  runDockerImageAction: vi.fn(),
  pruneDockerResources: vi.fn(),
  listDockerContainerFiles: vi.fn(),
  copyFromDockerContainer: vi.fn(),
  copyToDockerContainer: vi.fn(),
  searchDockerRegistry: vi.fn(),
  loginDockerRegistry: vi.fn(),
  pullDockerRegistryImage: vi.fn(),
  pushDockerRegistryImage: vi.fn(),
  tagDockerImage: vi.fn(),
  saveDockerProjectConfig: vi.fn(),
  openDockerEnvFile: vi.fn(),
  deleteDockerEnvFile: vi.fn(),
  openDockerDevContainer: vi.fn(),
}));
const prompts = vi.hoisted(() => ({ answers: [] as Array<string | null> }));
const files = vi.hoisted(() => ({ select: vi.fn() }));

vi.mock("../services/docker-api", () => api);
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));
vi.mock("@/ui/dialog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ui/dialog")>()),
  showPromptDialog: async () => prompts.answers.shift() ?? null,
}));
vi.mock("@/features/file-system/stores/file-system.store", () => ({
  useFileSystemStore: (select: (state: unknown) => unknown) =>
    select({ handleFileSelect: files.select }),
}));
vi.mock("@/utils/external-url", () => ({ openExternalUrl: vi.fn(async () => {}) }));

const { DockerSidebar } = await import("../components/docker-sidebar");

enableMapSet();

const container = (overrides: Partial<DockerContainer>): DockerContainer => ({
  id: "c1",
  name: "web",
  image: "nginx:latest",
  command: "nginx",
  status: "Up 2 hours",
  state: "running",
  ports: "0.0.0.0:8080->80/tcp",
  networks: "bridge",
  createdAt: "2026-10-01",
  size: "2MB",
  ...overrides,
});

const inventory = (): DockerInventory => ({
  containers: [
    container({}),
    container({ id: "c2", name: "db", image: "postgres:16", state: "exited", status: "Exited" }),
  ],
  images: [
    {
      id: "img1",
      repository: "nginx",
      tag: "latest",
      digest: "sha256:1",
      size: "50MB",
      createdSince: "2 days ago",
    },
  ],
  volumes: [{ name: "pgdata", driver: "local", scope: "local", mountpoint: "/var/lib/pg" }],
  networks: [{ id: "n1", name: "bridge", driver: "bridge", scope: "local" } as never],
});

const emptyConfig = (): DockerProjectConfig => ({
  workspacePath: "/repo",
  buildPresets: [],
  runPresets: [],
  composePresets: [],
  debugPresets: [],
  workspaceDebugPresets: [],
  envFiles: [],
  devContainers: [],
});

const compose = (): DockerComposeProject => ({
  workspacePath: "/repo",
  files: ["/repo/compose.yaml"],
  services: [{ name: "api", state: "running", status: "Up", ports: "3000" } as never],
});

let client: QueryClient;
const last = <T,>(items: readonly T[]): T | undefined => items[items.length - 1];

let root: Root;
let host: HTMLDivElement;

async function flush() {
  await act(async () => {
    for (let index = 0; index < 6; index++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function render() {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <DockerSidebar />
      </QueryClientProvider>,
    ),
  );
  await flush();
}

const view = () => within(host);
const body = () => within(document.body);

async function click(element: Element) {
  await act(async () => {
    (element as HTMLElement).click();
  });
  await flush();
}

async function chooseAction(menuLabel: string, item: string) {
  await click(body().getByRole("button", { name: menuLabel }));
  await click(
    [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (element) => element.textContent?.trim() === item,
    )!,
  );
}

const containerRow = (name: string) =>
  view()
    .getAllByText(name)
    .map((element) => element.closest("button"))
    .find((button) => button && !button.hasAttribute("aria-label"))!;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  workspaceRuntimeRegistry.resetForTests();
  for (const fn of Object.values(api)) fn.mockReset();
  files.select.mockReset();
  prompts.answers = [];
  api.getDockerInventory.mockResolvedValue(inventory());
  api.getDockerComposeProject.mockResolvedValue(compose());
  api.getDockerProjectConfig.mockResolvedValue(emptyConfig());
  api.startDockerContainerLogStream.mockResolvedValue("stream-1");
  api.stopDockerContainerLogStream.mockResolvedValue(undefined);
  api.listDockerContainerFiles.mockResolvedValue([]);
  useSidebarStore.getState().actions.setDockerSection("resources");
  useProjectStore.setState({ rootFolderPath: "/repo" });
  client = createTestQueryClient();
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
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  client.clear();
  vi.unstubAllGlobals();
});

describe("Docker sidebar", () => {
  it("lists containers, images, volumes and networks and filters containers", async () => {
    await render();
    expect(view().getByRole("button", { name: "Actions for web" })).toBeTruthy();
    expect(view().getByRole("button", { name: "Actions for db" })).toBeTruthy();
    expect(view().getByText("nginx:latest")).toBeTruthy();
    expect(view().getByText("pgdata")).toBeTruthy();

    await click(view().getByRole("button", { name: "Docker view options" }));
    await click(
      [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find(
        (item) => item.textContent === "Running",
      )!,
    );
    expect(view().getByRole("button", { name: "Actions for web" })).toBeTruthy();
    expect(view().queryByRole("button", { name: "Actions for db" })).toBeNull();

    await click(view().getByRole("button", { name: "Docker view options" }));
    await click(
      [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find(
        (item) => item.textContent === "Stopped",
      )!,
    );
    expect(view().queryByRole("button", { name: "Actions for web" })).toBeNull();
    expect(view().getByRole("button", { name: "Actions for db" })).toBeTruthy();

    await click(view().getByRole("button", { name: "Docker view options" }));
    await click(
      [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) =>
        item.textContent?.includes("Refresh"),
      )!,
    );
    expect(api.getDockerInventory).toHaveBeenCalledTimes(2);
  });

  it("explains that Docker is not running and retries", async () => {
    api.getDockerInventory.mockRejectedValue(new Error("Cannot connect to the Docker daemon"));
    await render();
    expect(view().getByRole("button", { name: /Retry/ })).toBeTruthy();

    api.getDockerInventory.mockResolvedValue(inventory());
    await click(view().getByRole("button", { name: /Retry/ }));
    expect(view().getByRole("button", { name: "Actions for web" })).toBeTruthy();
  });

  it("stops a running container and reports a failed action", async () => {
    await render();
    api.runDockerContainerAction.mockResolvedValue(undefined);
    await chooseAction("Actions for web", "Stop");
    expect(api.runDockerContainerAction).toHaveBeenCalledWith("c1", "stop", false);

    api.runDockerContainerAction.mockRejectedValue(new Error("permission denied"));
    await chooseAction("Actions for db", "Remove");
    expect(api.runDockerContainerAction).toHaveBeenLastCalledWith("c2", "remove", true);
    expect(view().getByText("Docker action failed")).toBeTruthy();
    await click(view().getByRole("button", { name: "Dismiss docker action failed" }));
    expect(view().queryByText("Docker action failed")).toBeNull();
  });

  it("opens a shell and a debug session in a running container", async () => {
    const terminals: Array<{ command: string; name: string }> = [];
    const unsubscribe = onAppEvent("terminal:create-with-command", (payload) => {
      terminals.push(payload as never);
    });
    await render();
    await chooseAction("Actions for web", "Open shell");
    expect(terminals[0].name).toBe("Docker: web");
    expect(terminals[0].command).toContain("c1");

    prompts.answers = ["node --inspect app.js", "/app"];
    await chooseAction("Actions for web", "Debug");
    expect(terminals[1].name).toBe("Debug: web");
    expect(terminals[1].command).toContain("node --inspect app.js");
    expect(useDebuggerStore.getState().activeSession?.name).toBe("Debug: web");
    unsubscribe();
  });

  it("shows a selected container's logs", async () => {
    await render();
    await click(containerRow("web"));
    expect(api.startDockerContainerLogStream).toHaveBeenCalledWith("c1", expect.any(Number));
    expect(view().getByRole("textbox", { name: "Search container logs" })).toBeTruthy();
  });

  it("builds an image from the workspace and runs an image", async () => {
    await render();
    await click(view().getByRole("button", { name: /^Build$/ }));
    expect(body().getByText("Build Docker Image")).toBeTruthy();
    expect((body().getByPlaceholderText("/path/to/project") as HTMLInputElement).value).toBe(
      "/repo",
    );
    await act(async () => {
      fireEvent.change(body().getByPlaceholderText("my-app:latest"), {
        target: { value: "app:dev" },
      });
    });
    api.buildDockerImage.mockResolvedValue("");
    const buildButtons = body().getAllByRole("button", { name: "Build" });
    await click(last(buildButtons)!);
    expect(api.buildDockerImage).toHaveBeenCalledWith({
      contextPath: "/repo",
      dockerfilePath: "/repo/Dockerfile",
      tag: "app:dev",
      buildArgs: [],
    });
    expect(view().getByText("Docker image build completed.")).toBeTruthy();

    await chooseAction("Actions for nginx:latest", "Run");
    expect(body().getByText("Run Docker Image")).toBeTruthy();
    await act(async () => {
      fireEvent.change(body().getByPlaceholderText("8080:80"), {
        target: { value: "8080:80" },
      });
    });
    api.runDockerImage.mockResolvedValue("container-id\n");
    await click(last(body().getAllByRole("button", { name: "Run" }))!);
    expect(api.runDockerImage).toHaveBeenCalledWith(
      expect.objectContaining({ image: "nginx:latest", ports: ["8080:80"], detach: true }),
    );
    expect(view().getByText("container-id")).toBeTruthy();
  });

  it("saves a run preset from the run dialog", async () => {
    await render();
    await chooseAction("Actions for nginx:latest", "Run");
    prompts.answers = ["web server"];
    api.saveDockerProjectConfig.mockImplementation(async (path, config) => ({
      ...config,
      workspacePath: path,
    }));
    await click(body().getByRole("button", { name: "Save Preset" }));
    expect(api.saveDockerProjectConfig).toHaveBeenCalledWith(
      "/repo",
      expect.objectContaining({
        runPresets: [expect.objectContaining({ name: "web server", image: "nginx:latest" })],
      }),
    );
  });

  it("removes images and prunes only after typed confirmation", async () => {
    await render();
    api.runDockerImageAction.mockResolvedValue("");
    await chooseAction("Actions for nginx:latest", "Remove");
    expect(api.runDockerImageAction).toHaveBeenCalledWith("img1", "remove", false);
    expect(view().getByText("Removed nginx:latest.")).toBeTruthy();

    prompts.answers = ["nope"];
    await click(view().getByRole("button", { name: "Prune Images" }));
    expect(api.pruneDockerResources).not.toHaveBeenCalled();

    prompts.answers = ["prune"];
    api.pruneDockerResources.mockResolvedValue("Total reclaimed space: 1GB");
    await click(view().getByRole("button", { name: "Prune System" }));
    expect(api.pruneDockerResources).toHaveBeenCalledWith("system", true);
    expect(view().getByText("Total reclaimed space: 1GB")).toBeTruthy();
  });

  it("runs Compose project and service actions", async () => {
    useSidebarStore.getState().actions.setDockerSection("compose");
    await render();
    expect(view().getByText("Compose project")).toBeTruthy();
    expect(view().getByText("api")).toBeTruthy();

    api.runDockerComposeAction.mockResolvedValue("");
    await chooseAction("Compose project actions", "Stop project");
    expect(api.runDockerComposeAction).toHaveBeenCalledWith({
      workspacePath: "/repo",
      files: ["/repo/compose.yaml"],
      service: undefined,
      action: "down",
      envFiles: [],
    });
    expect(view().getByText("Docker Compose down completed.")).toBeTruthy();

    api.runDockerComposeAction.mockRejectedValue(new Error("no such service"));
    await chooseAction("Actions for api", "Restart");
    expect(view().getByText("Docker Compose is unavailable")).toBeTruthy();
  });

  it("saves a Compose preset with the workspace env files", async () => {
    useSidebarStore.getState().actions.setDockerSection("compose");
    api.getDockerProjectConfig.mockResolvedValue({
      ...emptyConfig(),
      envFiles: [{ path: "/repo/.env", relativePath: ".env", variableCount: 2, keys: [] }],
    });
    await render();
    prompts.answers = ["start all"];
    api.saveDockerProjectConfig.mockImplementation(async (path, config) => ({
      ...config,
      workspacePath: path,
    }));
    await chooseAction("Compose project actions", "Save preset");
    expect(api.saveDockerProjectConfig).toHaveBeenCalledWith(
      "/repo",
      expect.objectContaining({
        composePresets: [
          expect.objectContaining({ name: "start all", action: "up", envFiles: ["/repo/.env"] }),
        ],
      }),
    );
  });

  it("offers env files and presets for an empty project", async () => {
    useSidebarStore.getState().actions.setDockerSection("project");
    await render();
    expect(view().getByText("No env files or presets in this workspace")).toBeTruthy();

    api.openDockerEnvFile.mockResolvedValue({
      file: { path: "/repo/.env", relativePath: ".env", variableCount: 0, keys: [] },
      content: "",
    });
    prompts.answers = [".env"];
    await click(view().getByRole("button", { name: /Env/ }));
    expect(api.openDockerEnvFile).toHaveBeenCalledWith("/repo", ".env");
    expect(files.select).toHaveBeenCalledWith("/repo/.env", false);

    prompts.answers = ["debug api", "node --inspect", "/app"];
    api.saveDockerProjectConfig.mockImplementation(async (path, config) => ({
      ...config,
      workspacePath: path,
    }));
    await click(view().getByRole("button", { name: /Save Debug/ }));
    expect(api.saveDockerProjectConfig).toHaveBeenCalledWith(
      "/repo",
      expect.objectContaining({
        debugPresets: [
          {
            name: "debug api",
            command: "node --inspect",
            workdir: "/app",
            target: "container",
            source: "project",
          },
        ],
      }),
    );
  });

  it("manages project presets, env files and dev containers", async () => {
    useSidebarStore.getState().actions.setDockerSection("project");
    api.getDockerProjectConfig.mockResolvedValue({
      ...emptyConfig(),
      envFiles: [{ path: "/repo/.env", relativePath: ".env", variableCount: 1, keys: ["A"] }],
      buildPresets: [{ name: "prod", contextPath: "/repo", tag: "app:prod", buildArgs: ["A=1"] }],
      runPresets: [
        {
          name: "serve",
          image: "app:prod",
          ports: ["80:80"],
          volumes: [],
          env: [],
          envFiles: ["/repo/.env"],
        },
      ],
      composePresets: [{ name: "up all", files: [], action: "up", envFiles: [] }],
      debugPresets: [{ name: "inspect", command: "node --inspect", target: "container" }],
      devContainers: [
        {
          name: "Node",
          configPath: "/repo/.devcontainer/devcontainer.json",
          relativePath: ".devcontainer/devcontainer.json",
          kind: "image",
          image: "node:20",
          dockerComposeFiles: [],
        } as never,
      ],
    });
    await render();
    expect(view().getByText("1 variable")).toBeTruthy();

    await click(view().getByText(".env").closest("button")!);
    expect(files.select).toHaveBeenCalledWith("/repo/.env", false);

    await chooseAction("Actions for prod", "Use preset");
    expect((body().getByPlaceholderText("NODE_ENV=production") as HTMLTextAreaElement).value).toBe(
      "A=1",
    );
    await click(body().getByRole("button", { name: "Cancel" }));

    await chooseAction("Actions for serve", "Use preset");
    expect((body().getByPlaceholderText("nginx:latest") as HTMLInputElement).value).toBe(
      "app:prod",
    );
    await click(body().getByRole("button", { name: "Cancel" }));

    await click(containerRow("db"));
    await chooseAction("Actions for inspect", "Run");
    expect(view().getByText("Docker debug presets require a running container.")).toBeTruthy();
    await click(containerRow("web"));
    await chooseAction("Actions for inspect", "Run");
    expect(view().queryByText("Docker debug presets require a running container.")).toBeNull();
    expect(useDebuggerStore.getState().activeSession).toMatchObject({
      name: "Debug: web",
      configId: "docker-debug-preset-inspect",
    });

    api.runDockerComposeAction.mockResolvedValue("");
    await chooseAction("Actions for up all", "Run");
    expect(api.runDockerComposeAction).toHaveBeenCalledWith(
      expect.objectContaining({ files: ["/repo/compose.yaml"], action: "up" }),
    );

    api.openDockerDevContainer.mockResolvedValue({
      containerId: "dev1",
      command: "docker exec -it dev1 sh",
      name: "Node",
      output: "",
    });
    await chooseAction("Actions for Node", "Open");
    expect(api.openDockerDevContainer).toHaveBeenCalledWith(
      "/repo",
      "/repo/.devcontainer/devcontainer.json",
    );

    api.saveDockerProjectConfig.mockImplementation(async (path, config) => ({
      ...config,
      workspacePath: path,
    }));
    await chooseAction("Actions for prod", "Delete");
    expect(api.saveDockerProjectConfig).toHaveBeenLastCalledWith(
      "/repo",
      expect.objectContaining({ buildPresets: [] }),
    );

    prompts.answers = ["delete"];
    api.deleteDockerEnvFile.mockResolvedValue(undefined);
    await chooseAction("Actions for .env", "Delete");
    expect(api.deleteDockerEnvFile).toHaveBeenCalledWith("/repo", "/repo/.env");
  });

  it("shows a project config error and lets the user dismiss it", async () => {
    useSidebarStore.getState().actions.setDockerSection("project");
    await render();
    api.openDockerEnvFile.mockRejectedValue(new Error("outside workspace"));
    prompts.answers = ["../secrets.env"];
    await click(view().getByRole("button", { name: /Env/ }));
    expect(view().getByText("outside workspace")).toBeTruthy();
    await click(view().getByRole("button", { name: "Dismiss project docker action failed" }));
    expect(view().queryByText("outside workspace")).toBeNull();
  });
});
