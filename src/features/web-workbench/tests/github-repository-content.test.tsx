// @vitest-environment jsdom
import { fireEvent, within } from "@testing-library/dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.hoisted(() => {
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      invoke: () => Promise.resolve(null),
      transformCallback: () => 1,
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    },
  });
});

import GithubRepositoryContent from "@/features/web-workbench/components/github-repository-content";
import type { CloudWorkspaceController } from "@/features/web-workbench/services/cloud-workspace-controller";
import {
  createWebsiteApi,
  type WebsiteAccount,
} from "@/features/web-workbench/services/website-api";
import { configureWebApp, useWebAppStore } from "@/features/web-workbench/stores/web-app.store";
import { createWebsiteFetch, proUser } from "@/features/web-workbench/tests/website-fetch";

const ready: WebsiteAccount = {
  status: "signed-in",
  user: proUser,
  plan: "pro",
  cloudEditor: true,
  githubConnected: true,
};

let container: HTMLDivElement;
let root: Root;
let controller: { open: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> };
const onClose = vi.fn();

function setup(account: WebsiteAccount) {
  const site = createWebsiteFetch({
    "GET /api/integrations/github/repos": {
      body: {
        repos: [
          { fullName: "athasdev/athas", private: false, description: "The editor" },
          { fullName: "ada/notes", private: true, description: null },
        ],
      },
    },
    "GET /api/cloud-workspaces/branches": {
      body: { defaultBranch: "main", branches: [{ name: "dev" }, { name: "main" }] },
    },
  });
  controller = { open: vi.fn(async () => {}), stop: vi.fn(async () => {}) };
  configureWebApp({
    api: createWebsiteApi(site.fetch),
    controller: {
      ...controller,
      resume: vi.fn(),
      getState: () => ({ phase: "idle", workspace: null, error: null }),
    } as unknown as CloudWorkspaceController,
  });
  useWebAppStore.setState({ account });
  return site;
}

async function render() {
  await act(async () => {
    root.render(<GithubRepositoryContent onBack={vi.fn()} onClose={onClose} />);
  });
  return within(container);
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  onClose.mockClear();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("GitHub repository step", () => {
  it("asks a signed-out visitor to sign in and returns them to the app", async () => {
    setup({ status: "signed-out" });
    const assign = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({
      ...window.location,
      pathname: "/app/",
      search: "",
      assign,
    } as Location);

    const view = await render();
    fireEvent.click(view.getByRole("button", { name: /Sign In/ }));

    expect(assign).toHaveBeenCalledWith("/auth/sign-in?next=%2Fapp%2F");
    vi.restoreAllMocks();
  });

  it("offers Pro to a free account and GitHub to a Pro account without it", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    setup({ ...ready, plan: "free", cloudEditor: false, githubConnected: false });
    let view = await render();
    fireEvent.click(view.getByRole("button", { name: /Upgrade to Pro/ }));
    expect(open).toHaveBeenLastCalledWith("/dashboard/settings/billing", "_blank", "noopener");

    setup({ ...ready, githubConnected: false });
    view = await render();
    fireEvent.click(view.getByRole("button", { name: /Connect GitHub/ }));
    expect(open).toHaveBeenLastCalledWith("/dashboard/settings/integrations", "_blank", "noopener");
    open.mockRestore();
  });

  it("lists repositories and branches and opens the chosen branch in the cloud", async () => {
    const site = setup(ready);
    const view = await render();

    const repo = await view.findByText("athasdev/athas");
    expect(view.getByText("ada/notes")).toBeTruthy();
    await act(async () => fireEvent.click(repo));

    await view.findByText("dev");
    const rows = view.getAllByRole("button").map((button) => button.textContent ?? "");
    expect(rows.findIndex((text) => text.includes("main"))).toBeLessThan(
      rows.findIndex((text) => text.includes("dev")),
    );
    expect(view.getByText("Default")).toBeTruthy();
    await act(async () => fireEvent.click(view.getByText("dev")));

    expect(onClose).toHaveBeenCalled();
    expect(controller.open).toHaveBeenCalledWith("athasdev/athas", "dev");
    expect(site.requests.map((request) => request.path)).toEqual([
      "/api/integrations/github/repos",
      "/api/cloud-workspaces/branches?repo=athasdev%2Fathas",
    ]);
  });

  it("shows the workspace in use and stops it", async () => {
    setup(ready);
    useWebAppStore.setState({
      cloud: {
        phase: "connected",
        error: null,
        workspace: {
          id: "w",
          repo: "athasdev/athas",
          branch: "main",
          status: "running",
          stopReason: null,
          error: null,
        },
      },
    });
    const view = await render();

    expect(view.getByText("athasdev/athas on main")).toBeTruthy();
    await act(async () => fireEvent.click(view.getByRole("button", { name: /Stop Workspace/ })));
    expect(controller.stop).toHaveBeenCalled();
  });
});
