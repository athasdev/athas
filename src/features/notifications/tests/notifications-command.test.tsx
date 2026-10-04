// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { GitHubNotification } from "@/features/github/types/github.types";
import { NotificationsCommand } from "../components/notifications-command";
import { useNotificationsStore } from "../stores/notifications.store";
import type { NotificationCategoryFilter } from "../types/notifications.types";

const writeClipboardText = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "main" }),
  getAllWebviewWindows: async () => [],
}));
vi.mock("@/utils/clipboard", () => ({ writeClipboardText }));
vi.mock("@/features/github/components/github-auth-status", () => ({
  GitHubAuthStatusMessage: () => <div>Sign in to GitHub</div>,
}));

let container: HTMLDivElement;
let root: Root;
const onClose = vi.fn();

function githubModel(
  overrides: Partial<Parameters<typeof NotificationsCommand>[0]["github"]> = {},
) {
  return {
    isAuthenticated: true,
    notifications: [] as GitHubNotification[],
    isLoading: false,
    error: null,
    refresh: vi.fn(() => Promise.resolve()),
    openNotification: vi.fn(),
    ...overrides,
  };
}

const pullRequest: GitHubNotification = {
  id: "gh-1",
  title: "Review the parser rewrite",
  subjectType: "PullRequest",
  reason: "review_requested",
  unread: true,
  updatedAt: new Date().toISOString(),
  lastReadAt: null,
  repositoryFullName: "athasdev/athas",
  url: "https://github.com/athasdev/athas/pull/1",
  subjectUrl: "",
};

async function render(github = githubModel(), initialCategory: NotificationCategoryFilter = "all") {
  await act(async () =>
    root.render(
      <NotificationsCommand
        isVisible
        initialCategory={initialCategory}
        github={github}
        onClose={onClose}
      />,
    ),
  );
  return github;
}

function text() {
  return document.body.textContent ?? "";
}

function button(name: string) {
  const match = Array.from(
    document.body.querySelectorAll<HTMLElement>("button, [role='tab']"),
  ).find(
    (element) =>
      element.getAttribute("aria-label") === name || element.textContent?.trim() === name,
  );
  if (!match) throw new Error(`No button named ${name}`);
  return match;
}

async function search(value: string) {
  const input = document.body.querySelector<HTMLInputElement>(
    "input[aria-label='Search notifications']",
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.getAnimations = () => [];
  onClose.mockClear();
  writeClipboardText.mockClear();
  const { record, clear } = useNotificationsStore.getState().actions;
  clear();
  record({ id: "build", message: "Build failed", description: "3 errors", type: "error" });
  record({ id: "agent", message: "Agent finished", type: "success", category: "agent" });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("notifications command", () => {
  it("marks everything read and refreshes GitHub when opened", async () => {
    const github = await render();

    expect(useNotificationsStore.getState().notifications.every((item) => item.read)).toBe(true);
    expect(github.refresh).toHaveBeenCalled();
  });

  it("groups local and GitHub notifications under their categories", async () => {
    await render(githubModel({ notifications: [pullRequest] }));

    expect(text()).toContain("Build failed");
    expect(text()).toContain("Agent finished");
    expect(text()).toContain("Review the parser rewrite");
    expect(text()).toContain("athasdev/athas · Review requested");
  });

  it("filters by category tab", async () => {
    await render(githubModel({ notifications: [pullRequest] }), "agent");

    expect(text()).toContain("Agent finished");
    expect(text()).not.toContain("Build failed");
    expect(text()).not.toContain("Review the parser rewrite");

    await act(async () => button("GitHub").click());
    expect(text()).toContain("Review the parser rewrite");
    expect(text()).not.toContain("Agent finished");
  });

  it("filters by search query and explains an empty result", async () => {
    await render();

    await search("3 errors");
    expect(text()).toContain("Build failed");
    expect(text()).not.toContain("Agent finished");

    await search("nothing like this");
    expect(text()).toContain("No matching notifications.");
  });

  it("deletes a single notification and clears the local list", async () => {
    await render();

    await act(async () => button("Delete Build failed").click());
    expect(useNotificationsStore.getState().notifications.map((item) => item.id)).toEqual([
      "agent",
    ]);

    await act(async () => button("Clear local notifications").click());
    expect(useNotificationsStore.getState().notifications).toEqual([]);
    expect(text()).toContain("No notifications yet.");
  });

  it("closes the palette and opens the GitHub notification that was picked", async () => {
    const github = await render(githubModel({ notifications: [pullRequest] }), "github");

    const row = Array.from(document.body.querySelectorAll<HTMLElement>("button")).find((element) =>
      element.textContent?.includes("Review the parser rewrite"),
    )!;
    await act(async () => row.click());

    expect(onClose).toHaveBeenCalled();
    expect(github.openNotification).toHaveBeenCalledWith(pullRequest);
  });

  it("asks to sign in or retry on the GitHub tab when GitHub is unavailable", async () => {
    await render(githubModel({ isAuthenticated: false }), "github");
    expect(text()).toContain("Sign in to GitHub");

    const github = githubModel({ error: "rate limited" });
    await render(github, "github");
    expect(text()).toContain("Could not load GitHub notifications.");
    await act(async () => button("Try again").click());
    expect(github.refresh).toHaveBeenLastCalledWith(true);
  });

  it("copies a notification from its detail view", async () => {
    await render();

    const rows = Array.from(document.body.querySelectorAll<HTMLElement>("div")).filter((element) =>
      element.textContent?.trim().startsWith("Build failed"),
    );
    const row = rows[rows.length - 1];
    await act(async () => row.click());
    await act(async () => button("Copy").click());

    expect(writeClipboardText).toHaveBeenCalledWith(
      expect.stringContaining("Build failed\n\n3 errors\n\nerror - "),
    );
    expect(text()).toContain("Copied");
  });
});
