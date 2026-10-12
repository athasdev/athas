// @vitest-environment jsdom
import { fireEvent, within } from "@testing-library/dom";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import { createTestQueryClient } from "@/utils/tests/query-test-client";
import { pullRequestDetails } from "./github-view-fixtures";

vi.hoisted(() => {
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      invoke: () => Promise.resolve(null),
      transformCallback: () => 1,
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    },
    __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
  });
});

const mocks = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
  openUrl: vi.fn(async () => {}),
  confirm: vi.fn(async () => true),
  clipboard: [] as string[],
  fileSelect: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: mocks.openUrl }));
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/ui/dialog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ui/dialog")>()),
  showConfirmDialog: mocks.confirm,
}));
vi.mock("@/utils/clipboard", () => ({
  writeClipboardText: async (text: string) => {
    mocks.clipboard.push(text);
  },
}));
vi.mock("@/extensions/icon-themes/components/themed-file-icon", () => ({
  ThemedFileIcon: () => null,
}));
vi.mock("@/features/file-system/stores/file-system.store", () => ({
  useFileSystemStore: (select: (state: unknown) => unknown) =>
    select({ handleFileSelect: mocks.fileSelect }),
}));
vi.mock("@/features/github/services/github-token-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/github/services/github-token-service")>()),
  syncGitHubTokenFromAccount: vi.fn(async () => ({ status: "notConnected" })),
}));
vi.mock("../components/github-markdown", () => ({
  default: ({ content }: { content: string }) => <div data-markdown>{content}</div>,
}));
vi.mock("../components/github-markdown-editor", () => ({
  GitHubMarkdownEditor: ({
    value,
    onChange,
    placeholder,
    disabled,
  }: {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    disabled?: boolean;
  }) => (
    <textarea
      aria-label={placeholder}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));
vi.mock("@/features/editor/stores/buffer.store", async () => {
  const { create } = await import("zustand");
  const { createSelectors } = await import("@/utils/zustand-selectors");
  type Buffer = { id: string } & Record<string, unknown>;
  const store = create<{ buffers: Buffer[]; actions: Record<string, unknown> }>()((set) => ({
    buffers: [],
    actions: {
      updateBuffer: (next: Buffer) =>
        set((state) => ({
          buffers: state.buffers.map((buffer) => (buffer.id === next.id ? next : buffer)),
        })),
      openContent: vi.fn(),
      openBuffer: vi.fn(),
    },
  }));
  return { useBufferStore: createSelectors(store) };
});

const { default: GitHubPRViewer } = await import("../components/github-pr-viewer");
const { useBufferStore } = await import("@/features/editor/stores/buffer.store");
const { useGitHubStore } = await import("../stores/github.store");

const mockInvoke = vi.mocked(invoke);
type Handler = (args: Record<string, any>) => unknown;
let handlers: Record<string, Handler>;

function calls(command: string) {
  return mockInvoke.mock.calls
    .filter(([name]) => name === command)
    .map(([, args]) => args as Record<string, unknown> | undefined);
}

const DIFF = [
  "diff --git a/src/parser.ts b/src/parser.ts",
  "index 1111111..2222222 100644",
  "--- a/src/parser.ts",
  "+++ b/src/parser.ts",
  "@@ -1,2 +1,3 @@",
  " const a = 1;",
  "-const b = 2;",
  "+const b = 3;",
  "+const c = 4;",
  "diff --git a/README.md b/README.md",
  "index 3333333..4444444 100644",
  "--- a/README.md",
  "+++ b/README.md",
  "@@ -1 +1 @@",
  "-old",
  "+new",
  "",
].join("\n");

let client: QueryClient;
let root: Root;
let host: HTMLDivElement;

async function settle() {
  await act(async () => {
    for (let index = 0; index < 10; index++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function render(path = "pr://7") {
  useBufferStore.setState({
    buffers: [
      { id: "pr-buffer", type: "pullRequest", prNumber: 7, path, name: "PR #7", repoPath: "/repo" },
    ] as never,
  });
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <GitHubPRViewer prNumber={7} bufferId="pr-buffer" />
      </QueryClientProvider>,
    ),
  );
  await settle();
}

const view = () => within(host);

async function click(element: Element) {
  await act(async () => {
    (element as HTMLElement).click();
  });
  await settle();
}

async function typeInto(input: HTMLElement, value: string) {
  await act(async () => {
    fireEvent.change(input, { target: { value } });
  });
  await settle();
}

function menuItem(label: string) {
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (element) => element.textContent?.trim() === label,
  );
  if (!item) throw new Error(`menu item ${label} not found`);
  return item;
}

async function choosePRAction(label: string) {
  await click(view().getByRole("button", { name: "Pull request actions" }));
  await click(menuItem(label));
}

const prBuffer = () => useBufferStore.getState().buffers[0] as Record<string, unknown>;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  workspaceRuntimeRegistry.resetForTests();
  useGitHubStore.getState().actions.reset();
  useGitHubStore.setState({ currentUser: "ada" });
  for (const fn of [...Object.values(mocks.toast), mocks.openUrl, mocks.fileSelect]) fn.mockReset();
  mocks.confirm.mockReset();
  mocks.confirm.mockResolvedValue(true);
  mocks.clipboard = [];
  handlers = {
    github_get_pr_details: () => pullRequestDetails(7, { title: "Rework the parser" }),
    github_get_pr_comments: () => [
      {
        id: 41,
        author: { login: "ada" },
        body: "Looks good to me",
        createdAt: "2026-10-03T00:00:00Z",
        updatedAt: "2026-10-03T00:00:00Z",
        url: "https://github.com/athasdev/athas/pull/7#issuecomment-41",
      },
    ],
    github_get_pr_diff: () => DIFF,
    github_get_pr_files: () => [
      { path: "src/parser.ts", additions: 2, deletions: 1 },
      { path: "README.md", additions: 1, deletions: 1 },
    ],
    github_list_labels: () => [{ name: "enhancement", color: "a2eeef" }],
    github_list_milestones: () => [],
    github_list_issue_types: () => [],
  };
  mockInvoke.mockReset();
  mockInvoke.mockImplementation(async (command, args) => {
    const handler = handlers[command];
    return handler ? handler((args ?? {}) as Record<string, any>) : null;
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  Element.prototype.getAnimations = () => [];
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  client = createTestQueryClient();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  client.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GitHub pull request viewer", () => {
  it("shows the pull request overview and names the tab after it", async () => {
    await render();

    expect(view().getByText("#7")).toBeTruthy();
    expect(view().getByText("feature-7")).toBeTruthy();
    expect(view().getByText("Fixes the **parser**.")).toBeTruthy();
    expect(view().getByText("Looks good to me")).toBeTruthy();
    expect(view().getByText("1 checks passed")).toBeTruthy();
    expect(prBuffer().name).toBe("Rework the parser");
    expect(calls("github_get_pr_comments")).toEqual([{ repoPath: "/repo", prNumber: 7 }]);
  });

  it("shows a failed load and retries it", async () => {
    let attempts = 0;
    handlers.github_get_pr_details = () => {
      attempts += 1;
      if (attempts === 1) throw new Error("Not Found");
      return pullRequestDetails(7, { title: "Found it" });
    };
    await render();

    expect(view().getByText("Not Found")).toBeTruthy();
    expect(view().getByText("PR #7")).toBeTruthy();
    await click(view().getByRole("button", { name: "Retry" }));

    expect(prBuffer().name).toBe("Found it");
  });

  it("switches to the changes view and back", async () => {
    await render();

    await click(view().getByRole("button", { name: /Changes/ }));
    expect(prBuffer().path).toMatch(/^pr:\/\/7\?(view=files|file=)/);
    expect(calls("github_get_pr_diff")).toEqual([{ repoPath: "/repo", prNumber: 7 }]);
    expect(view().getByText("2 files")).toBeTruthy();
    expect(prBuffer().path).toBe(`pr://7?file=${encodeURIComponent("src/parser.ts")}`);

    await click(view().getByRole("button", { name: /Overview/ }));
    expect(prBuffer().path).toBe("pr://7");
    expect(view().getByText("Looks good to me")).toBeTruthy();
  });

  it("opens straight into a deep-linked file", async () => {
    await render(`pr://7?file=${encodeURIComponent("README.md")}`);

    expect(view().getByText("2 files")).toBeTruthy();
    expect(prBuffer().path).toBe(`pr://7?file=${encodeURIComponent("README.md")}`);
  });

  it("shows a failed diff load", async () => {
    handlers.github_get_pr_diff = () => {
      throw new Error("diff too large");
    };
    await render("pr://7?view=files");

    expect(view().getByText("diff too large")).toBeTruthy();
  });

  it("shows when a pull request has no file changes", async () => {
    handlers.github_get_pr_files = () => [];
    handlers.github_get_pr_diff = () => "";
    await render("pr://7?view=files");

    expect(view().getByText("No file changes")).toBeTruthy();
  });

  it("posts a comment", async () => {
    await render();

    await typeInto(view().getByRole("textbox", { name: "Comment" }), "  Ship it  ");
    await click(view().getByRole("button", { name: "Comment" }));

    expect(calls("github_add_pr_comment")).toEqual([
      { repoPath: "/repo", prNumber: 7, body: "Ship it" },
    ]);
    expect(mocks.toast.success).toHaveBeenCalledWith("Comment added");
  });

  it("edits and deletes the user's own comment", async () => {
    await render();

    await click(view().getByRole("button", { name: "Comment actions" }));
    await click(menuItem("Edit"));
    await typeInto(view().getByRole("textbox", { name: "Edit comment..." }), "Updated text");
    await click(view().getByRole("button", { name: "Save" }));
    expect(calls("github_update_issue_comment")).toEqual([
      { repoPath: "/repo", commentId: 41, body: "Updated text" },
    ]);
    expect(mocks.toast.success).toHaveBeenCalledWith("Comment updated");

    await click(view().getByRole("button", { name: "Comment actions" }));
    await click(menuItem("Delete"));
    expect(calls("github_delete_issue_comment")).toEqual([{ repoPath: "/repo", commentId: 41 }]);
    expect(mocks.toast.success).toHaveBeenCalledWith("Comment deleted");
  });

  it("reports failed comment edits and deletes", async () => {
    handlers.github_update_issue_comment = () => {
      throw new Error("edit forbidden");
    };
    handlers.github_delete_issue_comment = () => {
      throw new Error("delete forbidden");
    };
    await render();

    await click(view().getByRole("button", { name: "Comment actions" }));
    await click(menuItem("Edit"));
    await typeInto(view().getByRole("textbox", { name: "Edit comment..." }), "Nope");
    await click(view().getByRole("button", { name: "Save" }));
    expect(mocks.toast.error).toHaveBeenCalledWith("edit forbidden");

    await click(view().getByRole("button", { name: "Comment actions" }));
    await click(menuItem("Delete"));
    expect(mocks.toast.error).toHaveBeenCalledWith("delete forbidden");
  });

  it("edits the description", async () => {
    await render();

    await click(view().getByRole("button", { name: "Edit description" }));
    await typeInto(view().getByRole("textbox", { name: "Write a description..." }), "New body");
    await click(view().getByRole("button", { name: "Save" }));

    expect(calls("github_update_pull_request")).toEqual([
      {
        repoPath: "/repo",
        prNumber: 7,
        title: "Rework the parser",
        body: "New body",
        labels: ["bug"],
        assignees: [],
      },
    ]);
    expect(mocks.toast.success).toHaveBeenCalledWith("Pull request updated");
  });

  it("reports a failed description update", async () => {
    handlers.github_update_pull_request = () => {
      throw new Error("validation failed");
    };
    await render();

    await click(view().getByRole("button", { name: "Edit description" }));
    await typeInto(view().getByRole("textbox", { name: "Write a description..." }), "x");
    await click(view().getByRole("button", { name: "Save" }));

    expect(mocks.toast.error).toHaveBeenCalledWith("validation failed");
  });

  it("merges with the chosen method", async () => {
    await render();

    await click(view().getByRole("button", { name: "Merge" }));
    expect(view().getByText("Merge pull request")).toBeTruthy();
    await click(view().getByRole("button", { name: "Rebase" }));
    const section = view().getByText("Merge pull request").closest("section")!;
    await click(
      within(section as HTMLElement)
        .getAllByRole("button", { name: /^Merge/ })
        .slice(-1)[0],
    );

    expect(calls("github_merge_pull_request")).toEqual([
      { repoPath: "/repo", prNumber: 7, method: "rebase" },
    ]);
    expect(mocks.toast.success).toHaveBeenCalledWith("Pull request merged");
    expect(view().queryByText("Merge pull request")).toBeNull();
  });

  it("approves and requests changes through reviews", async () => {
    await render();

    await choosePRAction("Approve");
    await click(view().getByRole("button", { name: "Approve" }));
    expect(calls("github_submit_pr_review")).toEqual([
      { repoPath: "/repo", prNumber: 7, event: "APPROVE", body: "" },
    ]);
    expect(mocks.toast.success).toHaveBeenCalledWith("Pull request approved");

    await choosePRAction("Request changes");
    const submit = () =>
      within(view().getByText("Request changes", { selector: "h2" }).closest("section")!)
        .getAllByRole("button")
        .find((button) => button.textContent === "Request changes") as HTMLButtonElement;
    expect(submit().disabled).toBe(true);
    await typeInto(
      view().getByRole("textbox", { name: "Describe the requested changes..." }),
      "Please add tests",
    );
    await click(submit());
    expect(calls("github_submit_pr_review").slice(-1)[0]).toEqual({
      repoPath: "/repo",
      prNumber: 7,
      event: "REQUEST_CHANGES",
      body: "Please add tests",
    });
    expect(mocks.toast.success).toHaveBeenCalledWith("Changes requested");
  });

  it("reports a failed review and lets the user cancel it", async () => {
    handlers.github_submit_pr_review = () => {
      throw new Error("cannot approve own PR");
    };
    await render();

    await choosePRAction("Approve");
    await click(view().getByRole("button", { name: "Approve" }));
    expect(mocks.toast.error).toHaveBeenCalledWith("cannot approve own PR");

    await click(view().getByRole("button", { name: "Cancel" }));
    expect(view().queryByText("Approve pull request")).toBeNull();
  });

  it("closes the pull request after confirmation", async () => {
    await render();

    mocks.confirm.mockResolvedValueOnce(false);
    await choosePRAction("Close pull request");
    expect(calls("github_close_pull_request")).toEqual([]);

    await choosePRAction("Close pull request");
    expect(calls("github_close_pull_request")).toEqual([{ repoPath: "/repo", prNumber: 7 }]);
    expect(mocks.toast.success).toHaveBeenCalledWith("Pull request closed");

    handlers.github_close_pull_request = () => {
      throw new Error("already closed");
    };
    await choosePRAction("Close pull request");
    expect(mocks.toast.error).toHaveBeenCalledWith("already closed");
  });

  it("checks out, opens and copies the pull request", async () => {
    await render();

    await choosePRAction("Checkout branch");
    expect(calls("github_checkout_pr")).toEqual([{ repoPath: "/repo", prNumber: 7 }]);
    expect(mocks.toast.success).toHaveBeenCalledWith("Checked out PR #7");

    await choosePRAction("Open on GitHub");
    expect(mocks.openUrl).toHaveBeenCalledWith("https://github.com/athasdev/athas/pull/7");

    await choosePRAction("Copy link");
    await choosePRAction("Copy branch name");
    expect(mocks.clipboard).toEqual(["https://github.com/athasdev/athas/pull/7", "feature-7"]);

    const reads = calls("github_get_pr_details").length;
    await choosePRAction("Refresh");
    expect(calls("github_get_pr_details").length).toBeGreaterThan(reads);

    handlers.github_checkout_pr = () => {
      throw new Error("dirty tree");
    };
    await choosePRAction("Checkout branch");
    expect(mocks.toast.error).toHaveBeenCalledWith("dirty tree");
  });

  it("blocks merging and closing a merged pull request", async () => {
    handlers.github_get_pr_details = () =>
      pullRequestDetails(7, {
        state: "MERGED",
        mergedAt: "2026-10-04T00:00:00Z",
        statusChecks: [],
      });
    await render();

    expect(view().getByText("No checks reported")).toBeTruthy();
    expect((view().getByRole("button", { name: "Merged" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    await click(view().getByRole("button", { name: "Pull request actions" }));
    expect(menuItem("Close pull request").getAttribute("aria-disabled")).toBe("true");
  });

  it("explains conflicts that block merging", async () => {
    handlers.github_get_pr_details = () =>
      pullRequestDetails(7, {
        mergeable: "CONFLICTING",
        mergeStateStatus: "DIRTY",
        statusChecks: [],
      });
    await render();

    expect(view().getAllByText("Has conflicts")).toHaveLength(2);
    expect(
      (view().getByRole("button", { name: "Has conflicts" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("shows a repository metadata failure and retries it", async () => {
    let attempts = 0;
    handlers.github_list_labels = () => {
      attempts += 1;
      if (attempts === 1) throw new Error("labels unavailable");
      return [];
    };
    await render();

    expect(view().getByText(/labels unavailable/)).toBeTruthy();
    await click(view().getByRole("button", { name: /Retry/ }));
    expect(attempts).toBe(2);
  });
});
