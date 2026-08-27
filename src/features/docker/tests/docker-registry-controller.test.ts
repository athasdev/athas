import { describe, expect, it } from "vite-plus/test";
import {
  dockerRegistryReducer,
  initialDockerRegistryState,
  type DockerRegistryState,
} from "../hooks/use-docker-registry";
import type { DockerRegistrySearchResult } from "../types/docker.types";

const result = (name: string): DockerRegistrySearchResult => ({
  name,
  description: `${name} image`,
  starCount: "10",
  official: "[OK]",
  automated: "",
});

const state = (overrides: Partial<DockerRegistryState> = {}): DockerRegistryState => ({
  ...initialDockerRegistryState,
  ...overrides,
});

describe("Docker registry controller", () => {
  it("updates individual draft fields without discarding credentials or image inputs", () => {
    const current = state({
      draft: {
        registry: "registry.example.com",
        username: "athas",
        password: "secret",
        image: "athas/app:latest",
        target: "",
      },
    });

    expect(
      dockerRegistryReducer(current, {
        type: "set-draft-field",
        field: "target",
        value: "athas/app:stable",
      }).draft,
    ).toEqual({
      ...current.draft,
      target: "athas/app:stable",
    });
  });

  it("preserves previous results while a new search is running", () => {
    const results = [result("athas/app")];
    const started = dockerRegistryReducer(
      state({ results, error: "previous search failed", output: "Pulled image." }),
      { type: "search-started" },
    );

    expect(started).toMatchObject({
      results,
      error: null,
      output: "Pulled image.",
      isBusy: true,
    });
  });

  it("replaces successful search results and clears stale results on failure", () => {
    const results = [result("athas/app")];
    const succeeded = dockerRegistryReducer(state({ isBusy: true }), {
      type: "search-succeeded",
      results,
    });
    const failedWhileBusy = dockerRegistryReducer(succeeded, {
      type: "search-failed",
      error: "registry unavailable",
    });
    const failed = dockerRegistryReducer(failedWhileBusy, { type: "busy-finished" });

    expect(succeeded).toMatchObject({ results, isBusy: true });
    expect(failed).toMatchObject({ results: [], error: "registry unavailable", isBusy: false });
  });

  it("clears operation output at startup and passwords only after successful login", () => {
    const started = dockerRegistryReducer(
      state({
        output: "Previous output",
        error: "previous failure",
        draft: { ...initialDockerRegistryState.draft, password: "secret" },
      }),
      { type: "operation-started" },
    );
    const succeededWhileBusy = dockerRegistryReducer(started, {
      type: "operation-succeeded",
      output: "Docker registry login completed.",
      clearPassword: true,
    });
    const succeeded = dockerRegistryReducer(succeededWhileBusy, { type: "busy-finished" });

    expect(started).toMatchObject({ output: null, error: null, isBusy: true });
    expect(started.draft.password).toBe("secret");
    expect(succeededWhileBusy).toMatchObject({
      output: "Docker registry login completed.",
      isBusy: true,
    });
    expect(succeeded.draft.password).toBe("");
  });
});
