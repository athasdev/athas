import { describe, expect, it } from "vite-plus/test";
import {
  dockerInventoryReducer,
  initialDockerInventoryState,
  resolveSelectedContainerId,
  type DockerInventoryState,
} from "../hooks/use-docker-inventory";
import type { DockerContainer } from "../types/docker.types";

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

const state = (overrides: Partial<DockerInventoryState> = {}): DockerInventoryState => ({
  ...initialDockerInventoryState,
  ...overrides,
});

describe("Docker inventory controller", () => {
  it("preserves a valid selection and falls back to the first available container", () => {
    const containers = [container("container-a"), container("container-b")];

    expect(resolveSelectedContainerId("container-b", containers)).toBe("container-b");
    expect(resolveSelectedContainerId("missing", containers)).toBe("container-a");
    expect(resolveSelectedContainerId(null, containers)).toBe("container-a");
    expect(resolveSelectedContainerId("container-a", [])).toBeNull();
  });

  it("separates ordinary action errors from daemon availability failures", () => {
    const actionFailure = dockerInventoryReducer(state(), {
      type: "action-failed",
      message: "Container is already stopped",
    });
    const unavailable = dockerInventoryReducer(actionFailure, {
      type: "mark-unavailable",
      message: "Cannot connect to Docker",
      at: 42,
    });

    expect(actionFailure.error).toBe("Container is already stopped");
    expect(unavailable).toMatchObject({
      unavailable: { message: "Cannot connect to Docker", at: 42 },
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
