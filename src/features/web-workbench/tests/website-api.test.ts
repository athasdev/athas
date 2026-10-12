import { describe, expect, it } from "vite-plus/test";
import { createWebsiteApi, WebsiteApiError } from "@/features/web-workbench/services/website-api";
import { getSignInUrl } from "@/features/web-workbench/services/website-links";
import {
  createWebsiteFetch,
  proUser,
  sessionBody,
  WORKSPACE_ID,
  workspaceBody,
} from "@/features/web-workbench/tests/website-fetch";

describe("website api", () => {
  it("reads a signed-out visitor from the session endpoint", async () => {
    const site = createWebsiteFetch({ "GET /api/auth/me": { body: { user: null } } });
    const api = createWebsiteApi(site.fetch);

    expect(await api.getAccount()).toEqual({ status: "signed-out" });
    expect(site.requests).toEqual([
      { method: "GET", path: "/api/auth/me", credentials: "same-origin", body: undefined },
    ]);
  });

  it("reads a free account without asking for GitHub", async () => {
    const site = createWebsiteFetch({
      "GET /api/auth/me": {
        body: { user: { ...proUser, avatarUrl: "https://a.example/ada.png" } },
      },
      "GET /api/auth/subscription": {
        body: { status: "free", capabilities: { cloudEditor: false } },
      },
    });

    expect(await createWebsiteApi(site.fetch).getAccount()).toEqual({
      status: "signed-in",
      user: { ...proUser, avatarUrl: "https://a.example/ada.png" },
      plan: "free",
      cloudEditor: false,
      githubConnected: false,
    });
    expect(site.requests.map((request) => request.path)).toEqual([
      "/api/auth/me",
      "/api/auth/subscription",
    ]);
  });

  it("reads the cloud editor capability and the GitHub connection of a Pro account", async () => {
    const site = createWebsiteFetch({
      "GET /api/auth/me": { body: { user: proUser } },
      "GET /api/auth/subscription": {
        body: { status: "pro", capabilities: { cloudEditor: true } },
      },
      "GET /api/integrations/github": { body: { connected: true } },
    });

    expect(await createWebsiteApi(site.fetch).getAccount()).toMatchObject({
      status: "signed-in",
      plan: "pro",
      cloudEditor: true,
      githubConnected: true,
    });
    expect(site.requests.every((request) => request.credentials === "same-origin")).toBe(true);
  });

  it("treats a session that ends between requests as signed out", async () => {
    const site = createWebsiteFetch({
      "GET /api/auth/me": { body: { user: proUser } },
      "GET /api/auth/subscription": { status: 401, body: { error: "Unauthorized" } },
    });
    expect(await createWebsiteApi(site.fetch).getAccount()).toEqual({ status: "signed-out" });
  });

  it("lists repositories and branches and opens, stops and gets tokens for workspaces", async () => {
    const site = createWebsiteFetch({
      "GET /api/integrations/github/repos": {
        body: {
          repos: [
            { fullName: "athasdev/athas", private: false, description: "The editor" },
            { fullName: "ada/notes", private: true, description: null },
            { name: "broken" },
          ],
        },
      },
      "GET /api/cloud-workspaces/branches": {
        body: { defaultBranch: "main", branches: [{ name: "main" }, { name: "dev" }] },
      },
      "POST /api/cloud-workspaces": workspaceBody("starting"),
      [`POST /api/cloud-workspaces/${WORKSPACE_ID}/stop`]: workspaceBody("stopped", {
        stopReason: "user",
      }),
      [`POST /api/cloud-workspaces/${WORKSPACE_ID}/token`]: sessionBody("token-1"),
    });
    const api = createWebsiteApi(site.fetch);

    expect(await api.listRepositories()).toEqual([
      { fullName: "athasdev/athas", private: false, description: "The editor" },
      { fullName: "ada/notes", private: true, description: null },
    ]);
    expect(await api.listBranches("athasdev/athas")).toEqual({
      defaultBranch: "main",
      branches: ["main", "dev"],
    });
    expect((await api.openWorkspace("athasdev/athas", "main")).status).toBe("starting");
    expect((await api.stopWorkspace(WORKSPACE_ID)).stopReason).toBe("user");
    expect((await api.createWorkspaceSession(WORKSPACE_ID)).token).toBe("token-1");
    expect(site.requests.map(({ method, path, body }) => ({ method, path, body }))).toEqual([
      { method: "GET", path: "/api/integrations/github/repos", body: undefined },
      {
        method: "GET",
        path: "/api/cloud-workspaces/branches?repo=athasdev%2Fathas",
        body: undefined,
      },
      {
        method: "POST",
        path: "/api/cloud-workspaces",
        body: { repo: "athasdev/athas", branch: "main" },
      },
      { method: "POST", path: `/api/cloud-workspaces/${WORKSPACE_ID}/stop`, body: undefined },
      { method: "POST", path: `/api/cloud-workspaces/${WORKSPACE_ID}/token`, body: undefined },
    ]);
  });

  it("refuses sessions for another workspace or an insecure endpoint", async () => {
    const other = {
      ...sessionBody("token-1").body.session,
      workspaceId: "1b6f7c1e-2f43-4a8e-9a51-3c2d1e0f9a87",
    };
    const insecure = {
      ...sessionBody("token-1").body.session,
      endpoint: "http://realtime.athas.dev",
    };
    for (const session of [other, insecure]) {
      const site = createWebsiteFetch({
        [`POST /api/cloud-workspaces/${WORKSPACE_ID}/token`]: { body: { session } },
      });
      await expect(
        createWebsiteApi(site.fetch).createWorkspaceSession(WORKSPACE_ID),
      ).rejects.toThrow("unexpected workspace session");
    }
  });

  it("reports the website's error message and code", async () => {
    const site = createWebsiteFetch({
      "POST /api/cloud-workspaces": {
        status: 402,
        body: { error: "Cloud workspaces are part of Athas Pro.", code: "pro_required" },
      },
    });
    const error = await createWebsiteApi(site.fetch)
      .openWorkspace("athasdev/athas", "main")
      .catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(WebsiteApiError);
    expect(error).toMatchObject({
      message: "Cloud workspaces are part of Athas Pro.",
      status: 402,
      code: "pro_required",
    });
  });

  it("sends sign-in back to where the user is in the app", () => {
    expect(getSignInUrl({ pathname: "/app/", search: "" })).toBe("/auth/sign-in?next=%2Fapp%2F");
    expect(getSignInUrl({ pathname: "/app/files", search: "?a=1" })).toBe(
      "/auth/sign-in?next=%2Fapp%2Ffiles%3Fa%3D1",
    );
    expect(getSignInUrl({ pathname: "/elsewhere", search: "" })).toBe("/auth/sign-in?next=%2Fapp");
  });
});
