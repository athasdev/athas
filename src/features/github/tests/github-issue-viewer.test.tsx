// @vitest-environment jsdom
import { fireEvent, within } from "@testing-library/dom";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import { createTestQueryClient } from "@/utils/tests/query-test-client";
import type { IssueComment, IssueDetails } from "../types/github.types";

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
  openExternalUrl: vi.fn(async () => {}),
  confirm: vi.fn(async () => true),
  clipboard: [] as string[],
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/utils/external-url", () => ({ openExternalUrl: mocks.openExternalUrl }));
vi.mock("@/ui/dialog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ui/dialog")>()),
  showConfirmDialog: mocks.confirm,
}));
vi.mock("@/utils/clipboard", () => ({
  writeClipboardText: async (text: string) => {
    mocks.clipboard.push(text);
  },
}));
vi.mock("../components/github-markdown", () => ({
  default: ({ content }: { content: string }) => <div data-markdown>{content}</div>,
}));
vi.mock("../components/github-markdown-editor", () => ({
  GitHubMarkdownEditor: ({
    value,
    onChange,
    placeholder,
  }: {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
  }) => (
    <textarea
      aria-label={placeholder}
      value={value}
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
    },
  }));
  return { useBufferStore: createSelectors(store) };
});

const { default: GitHubIssueViewer } = await import("../components/github-issue-viewer");
const { useBufferStore } = await import("@/features/editor/stores/buffer.store");
const { useGitHubStore } = await import("../stores/github.store");

const mockInvoke = vi.mocked(invoke);
type Handler = (args: Record<string, any>) => unknown;
let handlers: Record<string, Handler>;
let issue: IssueDetails;

function calls(command: string) {
  return mockInvoke.mock.calls
    .filter(([name]) => name === command)
    .map(([, args]) => args as Record<string, unknown> | undefined);
}

const comment = (id: number, login = "ada"): IssueComment => ({
  id,
  author: { login },
  body: `Comment ${id}`,
  createdAt: "2026-10-02T00:00:00Z",
  updatedAt: "2026-10-02T00:00:00Z",
  url: `https://github.com/athasdev/athas/issues/12#issuecomment-${id}`,
});

const issueDetails = (extra: Partial<IssueDetails> = {}): IssueDetails => ({
  number: 12,
  title: "Crash on save",
  body: "Steps to reproduce",
  state: "OPEN",
  author: { login: "linus" },
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-05T00:00:00Z",
  url: "https://github.com/athasdev/athas/issues/12",
  labels: [{ name: "bug", color: "d73a4a" } as never],
  assignees: [{ login: "ada" }],
  stateReason: null,
  locked: false,
  activeLockReason: null,
  milestone: { number: 3, title: "v1.0" } as never,
  issueType: null,
  closedAt: null,
  closedBy: null,
  comments: [comment(1), comment(2, "linus")],
  ...extra,
});

let client: QueryClient;
let root: Root;
let host: HTMLDivElement;

async function settle() {
  await act(async () => {
    for (let index = 0; index < 10; index++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function render(...args: [repoPath?: string]) {
  const repoPath = args.length > 0 ? args[0] : "/repo";
  useBufferStore.setState({
    buffers: [
      { id: "issue-buffer", type: "githubIssue", issueNumber: 12, name: "Issue #12" },
    ] as never,
  });
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <GitHubIssueViewer issueNumber={12} repoPath={repoPath} bufferId="issue-buffer" />
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

async function chooseIssueAction(label: string) {
  await click(view().getByRole("button", { name: "Issue actions" }));
  await click(menuItem(label));
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  workspaceRuntimeRegistry.resetForTests();
  useGitHubStore.getState().actions.reset();
  useGitHubStore.setState({ currentUser: "ada" });
  for (const fn of [...Object.values(mocks.toast), mocks.openExternalUrl]) fn.mockReset();
  mocks.confirm.mockReset();
  mocks.confirm.mockResolvedValue(true);
  mocks.clipboard = [];
  issue = issueDetails();
  handlers = {
    github_get_issue_details: () => issue,
    github_list_labels: () => [{ name: "triage", color: "ededed" }],
    github_list_milestones: () => [
      { number: 3, title: "v1.0" },
      { number: 4, title: "v2.0" },
    ],
    github_list_issue_types: () => [{ name: "Bug" }],
    github_update_issue_state: ({ state, stateReason }) => ({
      ...issue,
      state: state.toUpperCase(),
      stateReason: state === "closed" ? stateReason : null,
    }),
    github_update_issue: (args) => ({ ...issue, title: args.title, body: args.body }),
    github_add_issue_comment: ({ body }) => ({ ...comment(3), body }),
    github_update_issue_comment: ({ commentId, body }) => ({ ...comment(commentId), body }),
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

describe("GitHub issue viewer", () => {
  it("shows the issue and names its tab", async () => {
    await render();

    expect(view().getByText("Crash on save")).toBeTruthy();
    expect(view().getByText("Steps to reproduce")).toBeTruthy();
    expect(view().getByText("2 comments")).toBeTruthy();
    expect(view().getByText("Comment 1")).toBeTruthy();
    expect(view().getByText("Open")).toBeTruthy();
    expect(useBufferStore.getState().buffers[0]).toMatchObject({
      name: "Crash on save",
      url: "https://github.com/athasdev/athas/issues/12",
    });
  });

  it("needs a repository", async () => {
    await render(undefined);

    expect(view().getByText("No repository selected.")).toBeTruthy();
  });

  it("shows a failed load and retries it", async () => {
    let attempts = 0;
    handlers.github_get_issue_details = () => {
      attempts += 1;
      if (attempts === 1) throw new Error("issue not found");
      return issue;
    };
    await render();

    expect(view().getByText("issue not found")).toBeTruthy();
    await click(view().getByRole("button", { name: "Retry" }));
    expect(view().getByText("Crash on save")).toBeTruthy();
  });

  it("closes and reopens the issue", async () => {
    await render();

    await click(view().getByRole("button", { name: "Close" }));
    expect(calls("github_update_issue_state")).toEqual([
      { repoPath: "/repo", issueNumber: 12, state: "closed", stateReason: "completed" },
    ]);
    expect(mocks.toast.success).toHaveBeenCalledWith("Issue closed");
    expect(view().getByText("Closed as completed")).toBeTruthy();

    await click(view().getByRole("button", { name: "Reopen" }));
    expect(calls("github_update_issue_state").slice(-1)[0]).toMatchObject({
      state: "open",
      stateReason: "reopened",
    });
    expect(mocks.toast.success).toHaveBeenCalledWith("Issue reopened");
  });

  it("closes as not planned and reports failures", async () => {
    await render();

    await chooseIssueAction("Close as not planned");
    expect(calls("github_update_issue_state")).toEqual([
      { repoPath: "/repo", issueNumber: 12, state: "closed", stateReason: "not_planned" },
    ]);
    expect(view().getByText("Closed as not planned")).toBeTruthy();

    handlers.github_update_issue_state = () => {
      throw new Error("no permission");
    };
    await click(view().getByRole("button", { name: "Reopen" }));
    expect(mocks.toast.error).toHaveBeenCalledWith("no permission");
  });

  it("locks and unlocks the conversation", async () => {
    await render();

    await chooseIssueAction("Lock as resolved");
    expect(calls("github_lock_issue")).toEqual([
      { repoPath: "/repo", issueNumber: 12, lockReason: "resolved" },
    ]);
    expect(mocks.toast.success).toHaveBeenCalledWith("Issue locked");

    issue = issueDetails({ locked: true, activeLockReason: "spam" });
    await chooseIssueAction("Refresh");
    expect(view().getByText("Locked as spam")).toBeTruthy();
    expect((view().getByRole("textbox", { name: "Comment" }) as HTMLTextAreaElement).disabled).toBe(
      true,
    );

    await chooseIssueAction("Unlock conversation");
    expect(calls("github_unlock_issue")).toEqual([{ repoPath: "/repo", issueNumber: 12 }]);
    expect(mocks.toast.success).toHaveBeenCalledWith("Issue unlocked");
  });

  it("opens and copies the issue link", async () => {
    await render();

    await chooseIssueAction("Open on GitHub");
    expect(mocks.openExternalUrl).toHaveBeenCalledWith(
      "https://github.com/athasdev/athas/issues/12",
    );

    await chooseIssueAction("Copy link");
    expect(mocks.clipboard).toEqual(["https://github.com/athasdev/athas/issues/12"]);
  });

  it("renames the issue from its title", async () => {
    await render();

    await click(view().getByRole("button", { name: "Edit title" }));
    const title = view().getByRole("textbox", { name: "Title" });
    await typeInto(title, "Crash when saving large files");
    await act(async () => {
      fireEvent.keyDown(title, { key: "Enter" });
    });
    await settle();

    expect(calls("github_update_issue")).toEqual([
      {
        repoPath: "/repo",
        issueNumber: 12,
        title: "Crash when saving large files",
        body: "Steps to reproduce",
        labels: ["bug"],
        assignees: ["ada"],
        milestone: 3,
        issueType: null,
      },
    ]);
    expect(mocks.toast.success).toHaveBeenCalledWith("Issue updated");
  });

  it("edits the description and reports a failed save", async () => {
    handlers.github_update_issue = () => {
      throw new Error("body too long");
    };
    await render();

    await click(view().getByRole("button", { name: "Edit description" }));
    await typeInto(view().getByRole("textbox", { name: "Write a description..." }), "Longer");
    await click(view().getByRole("button", { name: "Save" }));

    expect(calls("github_update_issue")).toEqual([expect.objectContaining({ body: "Longer" })]);
    expect(mocks.toast.error).toHaveBeenCalledWith("body too long");
  });

  it("adds, edits and deletes comments", async () => {
    await render();

    await typeInto(view().getByRole("textbox", { name: "Comment" }), "Reproduced on main");
    await click(view().getByRole("button", { name: "Comment" }));
    expect(calls("github_add_issue_comment")).toEqual([
      { repoPath: "/repo", issueNumber: 12, body: "Reproduced on main" },
    ]);
    expect(view().getByText("Reproduced on main")).toBeTruthy();
    expect(view().getByText("3 comments")).toBeTruthy();

    const ownComment = () => view().getByText("Comment 1").closest("article") as HTMLElement;
    await click(within(ownComment()).getByRole("button", { name: "Comment actions" }));
    await click(menuItem("Edit"));
    await typeInto(view().getByRole("textbox", { name: "Edit comment..." }), "Edited comment");
    await click(view().getByRole("button", { name: "Save" }));
    expect(calls("github_update_issue_comment")).toEqual([
      { repoPath: "/repo", commentId: 1, body: "Edited comment" },
    ]);
    expect(view().getByText("Edited comment")).toBeTruthy();

    await click(
      within(view().getByText("Edited comment").closest("article") as HTMLElement).getByRole(
        "button",
        { name: "Comment actions" },
      ),
    );
    await click(menuItem("Delete"));
    expect(calls("github_delete_issue_comment")).toEqual([{ repoPath: "/repo", commentId: 1 }]);
    expect(mocks.toast.success).toHaveBeenCalledWith("Comment deleted");
    expect(view().queryByText("Edited comment")).toBeNull();
  });

  it("shows an issue without comments", async () => {
    issue = issueDetails({ comments: [], labels: [], assignees: [], milestone: null });
    await render();

    expect(view().getByText("No comments yet")).toBeTruthy();
    expect(view().getByText("0 comments")).toBeTruthy();
  });

  it("reveals long comment threads progressively", async () => {
    issue = issueDetails({
      comments: Array.from({ length: 12 }, (_, index) => comment(index + 1)),
    });
    await render();

    await vi.waitFor(() => expect(view().getByText("Comment 12")).toBeTruthy());
  });

  it("opens the milestone and shows metadata failures", async () => {
    let attempts = 0;
    handlers.github_list_labels = () => {
      attempts += 1;
      if (attempts === 1) throw new Error("metadata offline");
      return [];
    };
    await render();

    expect(view().getByText(/metadata offline/)).toBeTruthy();
    await click(view().getByRole("button", { name: /Retry/ }));
    expect(attempts).toBe(2);

    await click(view().getByRole("button", { name: "Open milestone on GitHub" }));
    expect(mocks.openExternalUrl).toHaveBeenCalledWith(
      "https://github.com/athasdev/athas/milestone/3",
    );
  });
});
