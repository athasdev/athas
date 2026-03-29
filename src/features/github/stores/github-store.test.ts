import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { GitHubAuthStatus } from "../types/github";

const invokeMock = mock(async (_command: string, _args?: Record<string, unknown>) => null);

mock.module("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

const noAuthStatus: GitHubAuthStatus = {
  source: "none",
  isAuthenticated: false,
  currentUser: null,
  cliAvailable: true,
  hasStoredPat: false,
  hasLegacyStoredToken: false,
};

describe("useGitHubStore", () => {
  beforeEach(async () => {
    invokeMock.mockReset();
    const { useGitHubStore } = await import("./github-store");
    useGitHubStore.getState().actions.reset();
  });

  test("refreshAuthStatus stores source-aware auth state", async () => {
    const authStatus: GitHubAuthStatus = {
      source: "gh",
      isAuthenticated: true,
      currentUser: "fsos",
      cliAvailable: true,
      hasStoredPat: true,
      hasLegacyStoredToken: false,
    };

    invokeMock.mockImplementation(async (command: string) => {
      if (command === "github_get_auth_status") {
        return authStatus;
      }

      throw new Error(`Unexpected command: ${command}`);
    });

    const { useGitHubStore } = await import("./github-store");
    const status = await useGitHubStore.getState().actions.refreshAuthStatus();
    const state = useGitHubStore.getState();

    expect(status).toEqual(authStatus);
    expect(state.authStatus).toEqual(authStatus);
    expect(state.authSource).toBe("gh");
    expect(state.currentUser).toBe("fsos");
    expect(state.hasStoredPat).toBe(true);
  });

  test("fetchPRs refreshes auth state after an auth failure", async () => {
    const statuses: GitHubAuthStatus[] = [
      {
        source: "gh",
        isAuthenticated: true,
        currentUser: "fsos",
        cliAvailable: true,
        hasStoredPat: false,
        hasLegacyStoredToken: false,
      },
      noAuthStatus,
    ];

    invokeMock.mockImplementation(async (command: string) => {
      if (command === "github_get_auth_status") {
        return statuses.shift() ?? noAuthStatus;
      }

      if (command === "github_list_prs") {
        throw new Error("401 unauthorized");
      }

      throw new Error(`Unexpected command: ${command}`);
    });

    const { useGitHubStore } = await import("./github-store");
    await useGitHubStore.getState().actions.refreshAuthStatus();
    await useGitHubStore.getState().actions.fetchPRs("/tmp/repo");

    const state = useGitHubStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.authSource).toBe("none");
    expect(state.error).toBeNull();
    expect(state.prs).toEqual([]);
  });

  test("storePatFallback updates auth state from the returned PAT status", async () => {
    const patStatus: GitHubAuthStatus = {
      source: "pat",
      isAuthenticated: true,
      currentUser: "fallback-user",
      cliAvailable: false,
      hasStoredPat: true,
      hasLegacyStoredToken: false,
    };

    invokeMock.mockImplementation(async (command: string) => {
      if (command === "store_github_pat_fallback") {
        return patStatus;
      }

      throw new Error(`Unexpected command: ${command}`);
    });

    const { useGitHubStore } = await import("./github-store");
    const status = await useGitHubStore.getState().actions.storePatFallback("github_pat_test");
    const state = useGitHubStore.getState();

    expect(status).toEqual(patStatus);
    expect(state.authSource).toBe("pat");
    expect(state.currentUser).toBe("fallback-user");
    expect(state.isAuthenticated).toBe(true);
  });
});
