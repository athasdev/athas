import { describe, expect, it } from "vite-plus/test";
import {
  dockerInventoryReducer,
  initialDockerInventoryState,
  type DockerInventoryState,
} from "../hooks/use-docker-inventory";
import type { DockerContainer, DockerInventory } from "../types/docker.types";

const container = (id: string): DockerContainer => ({
  id,
  name: id,
  image: "athas/test:latest",
  command: "bun test",
  status: "Up",
  state: "running",
  ports: "",
  networks: "bridge",
  createdAt: "now",
  size: "1 MB",
});

const inventory = (...containers: DockerContainer[]): DockerInventory => ({
  containers,
  images: [],
  volumes: [],
  networks: [],
});

const state = (overrides: Partial<DockerInventoryState> = {}): DockerInventoryState => ({
  ...initialDockerInventoryState,
  ...overrides,
});

describe("Docker inventory controller", () => {
  it("starts refreshes without discarding the current inventory or selection", () => {
    const currentInventory = inventory(container("container-a"));

    expect(
      dockerInventoryReducer(
        state({
          inventory: currentInventory,
          selectedContainerId: "container-a",
          isLoading: false,
          error: "Previous action failed",
        }),
        { type: "load-started" },
      ),
    ).toEqual(
      state({
        inventory: currentInventory,
        selectedContainerId: "container-a",
        isLoading: true,
        error: null,
      }),
    );
  });

  it("preserves a valid selection and falls back to the first available container", () => {
    const nextInventory = inventory(container("container-a"), container("container-b"));
    const preserved = dockerInventoryReducer(
      state({ selectedContainerId: "container-b", connectionError: "offline" }),
      { type: "load-succeeded", inventory: nextInventory },
    );
    const replaced = dockerInventoryReducer(state({ selectedContainerId: "missing" }), {
      type: "load-succeeded",
      inventory: nextInventory,
    });

    expect(preserved).toMatchObject({
      inventory: nextInventory,
      selectedContainerId: "container-b",
      isLoading: false,
      connectionError: null,
    });
    expect(replaced.selectedContainerId).toBe("container-a");
  });

  it("clears stale resources and selection when an inventory load fails", () => {
    expect(
      dockerInventoryReducer(
        state({
          inventory: inventory(container("container-a")),
          selectedContainerId: "container-a",
          isLoading: true,
        }),
        { type: "load-failed", message: "Docker daemon is unavailable" },
      ),
    ).toEqual(
      state({
        inventory: inventory(),
        selectedContainerId: null,
        isLoading: false,
        connectionError: "Docker daemon is unavailable",
      }),
    );
  });

  it("separates ordinary action errors from daemon availability failures", () => {
    const actionFailure = dockerInventoryReducer(state(), {
      type: "action-failed",
      message: "Container is already stopped",
    });
    const unavailable = dockerInventoryReducer(
      { ...actionFailure, inventory: inventory(container("container-a")) },
      { type: "mark-unavailable", message: "Cannot connect to Docker" },
    );

    expect(actionFailure.error).toBe("Container is already stopped");
    expect(unavailable).toMatchObject({
      inventory: inventory(),
      selectedContainerId: null,
      connectionError: "Cannot connect to Docker",
      error: null,
    });
  });

  it("updates explicit selection and dismisses action errors independently", () => {
    const selected = dockerInventoryReducer(state({ error: "failed" }), {
      type: "select-container",
      containerId: "container-b",
    });
    const dismissed = dockerInventoryReducer(selected, { type: "clear-error" });

    expect(selected.selectedContainerId).toBe("container-b");
    expect(selected.error).toBe("failed");
    expect(dismissed.error).toBeNull();
  });
});
