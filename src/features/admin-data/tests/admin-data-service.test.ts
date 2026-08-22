import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminDataSource } from "@/features/admin-data/types/admin-data.types";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  getRemotes: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-http", () => ({ fetch: mocks.fetch }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@/features/git/api/git-remotes-api", () => ({ getRemotes: mocks.getRemotes }));

import {
  loadAdminDataSource,
  loadAdminDataSourceTable,
} from "@/features/admin-data/services/admin-data-service";

function createSource(
  overrides: Partial<Extract<AdminDataSource, { kind: "json" }>> = {},
): AdminDataSource {
  return {
    id: "source",
    name: "Release stats",
    kind: "json",
    url: "https://api.example.com/releases",
    rowsPath: "",
    authentication: "none",
    ...overrides,
  };
}

describe("admin data service", () => {
  beforeEach(() => {
    mocks.fetch.mockReset();
    mocks.getRemotes.mockReset();
    mocks.invoke.mockReset();
  });

  it("loads a public JSON source as CSV", async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => [{ name: "Athas", downloads: 42 }],
    });

    await expect(loadAdminDataSource(createSource())).resolves.toBe("name,downloads\nAthas,42");
    expect(mocks.fetch).toHaveBeenCalledWith("https://api.example.com/releases", {
      headers: { Accept: "application/json" },
    });
  });

  it("returns structured rows for the module table view", async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => [{ name: "Athas", downloads: 42 }],
    });

    await expect(loadAdminDataSourceTable(createSource())).resolves.toEqual({
      columns: ["name", "downloads"],
      rows: [["Athas", 42]],
    });
  });

  it("uses the connected account only for GitHub API sources", async () => {
    mocks.getRemotes.mockResolvedValue([
      { name: "origin", url: "git@github.com:athasdev/athas.git" },
    ]);
    mocks.invoke.mockResolvedValue("github-token");
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => [{ tag_name: "v1.0.0" }],
    });

    await loadAdminDataSource(
      {
        id: "releases",
        name: "Releases",
        kind: "github",
        endpointPath: "/releases?per_page=100",
        rowsPath: "",
      },
      "/projects/athas",
    );

    expect(mocks.invoke).toHaveBeenCalledWith("get_github_token");
    expect(mocks.fetch).toHaveBeenCalledWith(
      "https://api.github.com/repos/athasdev/athas/releases?per_page=100",
      {
        headers: {
          Accept: "application/json",
          Authorization: "Bearer github-token",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );
  });

  it("does not send GitHub credentials to another host", async () => {
    await expect(loadAdminDataSource(createSource({ authentication: "github" }))).rejects.toThrow(
      "GitHub authentication can only be used with api.github.com",
    );
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("reports unsuccessful source responses", async () => {
    mocks.fetch.mockResolvedValue({ ok: false, status: 403 });

    await expect(loadAdminDataSource(createSource())).rejects.toThrow(
      "Source request failed with HTTP 403",
    );
  });
});
