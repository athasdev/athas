// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createTestQueryClient } from "@/utils/tests/query-test-client";
import type {
  DockerComposeProject,
  DockerInventory,
  DockerRegistrySearchResult,
} from "../types/docker.types";

const api = vi.hoisted(() => ({
  getDockerInventory: vi.fn(),
  getDockerComposeProject: vi.fn(),
  getDockerProjectConfig: vi.fn(),
  searchDockerRegistry: vi.fn(),
}));

vi.mock("../services/docker-api", () => api);

const { useDockerInventory } = await import("../hooks/use-docker-inventory");
const { useDockerWorkspaceProject } = await import("../hooks/use-docker-workspace-project");
const { useDockerRegistry } = await import("../hooks/use-docker-registry");

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

const inventoryWithImage = (repository: string): DockerInventory => ({
  containers: [],
  images: [{ id: repository, repository, tag: "latest", size: "1 MB" } as never],
  volumes: [],
  networks: [],
});

const composeWithService = (workspacePath: string, name: string): DockerComposeProject =>
  ({
    workspacePath,
    files: [`${workspacePath}/compose.yaml`],
    services: [{ name } as never],
  }) as DockerComposeProject;

let client: QueryClient;
let container: HTMLDivElement;
let root: Root;

async function renderHook<T>(useHook: () => T) {
  const result = { current: undefined as T };
  function Harness({ revision }: { revision: number }) {
    result.current = useHook();
    return <span data-revision={revision} />;
  }
  let revision = 0;
  const render = () =>
    act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <Harness revision={revision++} />
        </QueryClientProvider>,
      ),
    );
  await render();
  return Object.assign(result, { rerender: render });
}

/** Query notifies observers on a macrotask, so wait a few of them. */
async function flush() {
  await act(async () => {
    for (let index = 0; index < 5; index++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  for (const mock of Object.values(api)) mock.mockReset();
  client = createTestQueryClient();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  client.clear();
});

describe("Docker inventory", () => {
  it("never lets an older inventory response replace a newer one", async () => {
    const slowInventory = deferred<DockerInventory>();
    api.getDockerInventory
      .mockResolvedValueOnce(inventoryWithImage("initial"))
      .mockReturnValueOnce(slowInventory.promise)
      .mockResolvedValueOnce(inventoryWithImage("after-second-action"));

    const inventory = await renderHook(() => useDockerInventory());
    await flush();
    expect(inventory.current.inventory.images[0]?.repository).toBe("initial");

    // Two Docker actions finish back to back; the first refresh answers last with older state.
    let firstRefresh!: Promise<unknown>;
    await act(async () => {
      firstRefresh = inventory.current.loadInventory();
      await Promise.resolve();
    });
    await act(async () => {
      await inventory.current.loadInventory();
    });
    slowInventory.resolve(inventoryWithImage("after-first-action"));
    await act(async () => {
      await firstRefresh;
    });
    await flush();

    expect(inventory.current.inventory.images[0]?.repository).toBe("after-second-action");
  });
});

describe("Docker workspace project", () => {
  it("shows only the current workspace after a switch, even when the old one answers late", async () => {
    const slowComposeA = deferred<DockerComposeProject>();
    api.getDockerComposeProject.mockImplementation((workspacePath: string) =>
      workspacePath === "/workspace-a"
        ? slowComposeA.promise
        : Promise.resolve(composeWithService(workspacePath, "service-b")),
    );
    api.getDockerProjectConfig.mockImplementation(async (workspacePath: string) => ({
      workspacePath,
      buildPresets: [],
      runPresets: [],
      composePresets: [],
      debugPresets: [],
      workspaceDebugPresets: [],
      envFiles: [],
      devContainers: [],
    }));

    let workspacePath = "/workspace-a";
    const project = await renderHook(() => useDockerWorkspaceProject(workspacePath));
    await act(async () => project.current.setComposeError("Compose up failed in A"));

    workspacePath = "/workspace-b";
    await project.rerender();
    await flush();
    slowComposeA.resolve(composeWithService("/workspace-a", "service-a"));
    await flush();

    expect(project.current.composeProject.workspacePath).toBe("/workspace-b");
    expect(project.current.composeProject.services.map((service) => service.name)).toEqual([
      "service-b",
    ]);
    expect(project.current.projectConfig.workspacePath).toBe("/workspace-b");
    expect(project.current.composeError).toBeNull();
  });
});

describe("Docker registry search", () => {
  it("keeps the results of the latest search when an earlier one finishes last", async () => {
    const slowSearch = deferred<DockerRegistrySearchResult[]>();
    const result = (name: string) => ({ name }) as DockerRegistrySearchResult;
    api.searchDockerRegistry
      .mockReturnValueOnce(slowSearch.promise)
      .mockResolvedValueOnce([result("redis")]);

    const registry = await renderHook(() =>
      useDockerRegistry({
        onDockerUnavailable: () => {},
        onInventoryChanged: async () => {},
      }),
    );

    await act(async () => registry.current.setQuery("postgres"));
    let firstSearch!: Promise<void>;
    await act(async () => {
      firstSearch = registry.current.search();
    });
    await act(async () => registry.current.setQuery("redis"));
    await act(async () => registry.current.search());
    slowSearch.resolve([result("postgres")]);
    await act(async () => firstSearch);

    expect(registry.current.results.map((item) => item.name)).toEqual(["redis"]);
    expect(registry.current.isBusy).toBe(false);
  });
});
