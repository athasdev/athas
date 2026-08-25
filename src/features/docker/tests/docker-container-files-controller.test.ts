import { describe, expect, it } from "vite-plus/test";
import {
  dockerContainerFilesReducer,
  initialDockerContainerFilesState,
  type DockerContainerFilesState,
} from "../hooks/use-docker-container-files";
import type { DockerContainerFileEntry } from "../types/docker.types";

const file = (path: string): DockerContainerFileEntry => ({
  name: path.split("/").pop() ?? path,
  path,
  isDirectory: false,
  size: 10,
  mode: "-rw-r--r--",
});

const state = (overrides: Partial<DockerContainerFilesState> = {}): DockerContainerFilesState => ({
  ...initialDockerContainerFilesState,
  ...overrides,
});

describe("Docker container files controller", () => {
  it("resets navigation and stale results when the container changes", () => {
    expect(
      dockerContainerFilesReducer(
        state({
          path: "/app",
          files: [file("/app/package.json")],
          isLoading: true,
          error: "failed",
        }),
        { type: "container-changed", containerId: "container-b" },
      ),
    ).toEqual(state({ containerId: "container-b" }));
  });

  it("starts loads without hiding the current directory contents", () => {
    const files = [file("/app/package.json")];

    expect(
      dockerContainerFilesReducer(state({ path: "/app", files, error: "failed" }), {
        type: "load-started",
      }),
    ).toEqual(state({ path: "/app", files, isLoading: true }));
  });

  it("replaces results on success and clears stale results on failure", () => {
    const files = [file("/app/package.json")];
    const loaded = dockerContainerFilesReducer(state({ isLoading: true }), {
      type: "load-succeeded",
      files,
    });
    const failed = dockerContainerFilesReducer(loaded, {
      type: "load-failed",
      error: "permission denied",
    });

    expect(loaded).toMatchObject({ files, isLoading: false, error: null });
    expect(failed).toMatchObject({ files: [], isLoading: false, error: "permission denied" });
  });

  it("keeps navigation and operation errors as independent transitions", () => {
    const navigated = dockerContainerFilesReducer(state(), {
      type: "path-changed",
      path: "/workspace",
    });
    const failed = dockerContainerFilesReducer(navigated, {
      type: "operation-failed",
      error: "copy failed",
    });
    const dismissed = dockerContainerFilesReducer(failed, { type: "clear-error" });

    expect(navigated.path).toBe("/workspace");
    expect(failed.error).toBe("copy failed");
    expect(dismissed.error).toBeNull();
  });
});
