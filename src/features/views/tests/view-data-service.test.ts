import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CustomViewDefinition } from "@/features/views/types/view.types";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  getRemotes: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-http", () => ({ fetch: mocks.fetch }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@/features/git/api/git-remotes-api", () => ({ getRemotes: mocks.getRemotes }));

import { loadViewData, loadViewTable } from "@/features/views/services/view-data-service";

function createView(
  overrides: Partial<Extract<CustomViewDefinition, { kind: "json" }>> = {},
): CustomViewDefinition {
  return {
    id: "view",
    name: "Release stats",
    kind: "json",
    url: "https://api.example.com/releases",
    rowsPath: "",
    authentication: "none",
    ...overrides,
  };
}

describe("custom view service", () => {
  beforeEach(() => {
    mocks.fetch.mockReset();
    mocks.getRemotes.mockReset();
    mocks.invoke.mockReset();
  });

  it("loads a public JSON view as CSV", async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => [{ name: "Athas", downloads: 42 }],
    });

    await expect(loadViewData(createView())).resolves.toBe("name,downloads\nAthas,42");
    expect(mocks.fetch).toHaveBeenCalledWith("https://api.example.com/releases", {
      headers: { Accept: "application/json" },
    });
  });

  it("returns structured rows for the module table view", async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => [{ name: "Athas", downloads: 42 }],
    });

    await expect(loadViewTable(createView())).resolves.toEqual({
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

    await loadViewData(
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
    await expect(loadViewData(createView({ authentication: "github" }))).rejects.toThrow(
      "GitHub authentication can only be used with api.github.com",
    );
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("reports unsuccessful source responses", async () => {
    mocks.fetch.mockResolvedValue({ ok: false, status: 403 });

    await expect(loadViewData(createView())).rejects.toThrow("Source request failed with HTTP 403");
  });
});
