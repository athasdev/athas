// @vitest-environment jsdom
import { fireEvent, within } from "@testing-library/dom";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import { clearRepositoryDiscoveryCache } from "@/features/git/api/git-repo-api";
import { createTestQueryClient } from "@/utils/tests/query-test-client";
import type { GitHubFormContent } from "@/features/panes/types/pane-content.types";
import { pullRequest } from "./github-view-fixtures";

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
  requestInlineEdit: vi.fn(),
  buffer: {
    closeBufferForce: vi.fn(),
    openGitHubIssueBuffer: vi.fn(),
    openPRBuffer: vi.fn(),
  },
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/features/ai/intelligence/services/intelligence-text-service", () => ({
  requestInlineEdit: mocks.requestInlineEdit,
}));
vi.mock("@/features/settings/stores/settings.store", async () => {
  const { create } = await import("zustand");
  return { useSettingsStore: create(() => ({ settings: { aiAutocompleteModelId: "model-1" } })) };
});
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
  return {
    useBufferStore: createSelectors(create(() => ({ buffers: [], actions: mocks.buffer }))),
  };
});

const { GitHubCreateView } = await import("../components/github-create-view");
const { useAuthStore } = await import("@/features/auth/stores/auth.store");

const mockInvoke = vi.mocked(invoke);
type Handler = (args: Record<string, any>) => unknown;
let handlers: Record<string, Handler>;

function calls(command: string) {
  return mockInvoke.mock.calls
    .filter(([name]) => name === command)
    .map(([, args]) => args as Record<string, unknown> | undefined);
}

let client: QueryClient;
let root: Root;
let host: HTMLDivElement;

async function settle() {
  await act(async () => {
    for (let index = 0; index < 10; index++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function render(formKind: GitHubFormContent["formKind"], defaultHead?: string) {
  const buffer = {
    id: "form-buffer",
    type: "githubForm",
    path: `github-form://${formKind}`,
    name: "New",
    repoPath: "/repo",
    formKind,
    operation: "create",
    defaultHead,
  } as unknown as GitHubFormContent;
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <GitHubCreateView buffer={buffer} />
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

const createButton = () => view().getByRole("button", { name: "Create" }) as HTMLButtonElement;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  workspaceRuntimeRegistry.resetForTests();
  clearRepositoryDiscoveryCache();
  useAuthStore.setState({ subscription: null });
  for (const fn of [...Object.values(mocks.toast), ...Object.values(mocks.buffer)]) fn.mockReset();
  mocks.requestInlineEdit.mockReset();
  handlers = {
    git_discover_repo: ({ path }) => (path.startsWith("/repo") ? "/repo" : null),
    git_branches: () => ["main", "feature/login"],
    git_status: () => ({
      branch: "feature/login",
      files: [{ path: "src/login.ts", status: "modified", staged: true }],
      ahead: 0,
      behind: 0,
    }),
    git_ref_diff: () => [
      {
        file_path: "src/login.ts",
        lines: [
          { line_type: "added", content: "export const login = true;" },
          { line_type: "context", content: "" },
        ],
      },
    ],
    github_list_labels: () => [{ name: "bug", color: "d73a4a" }],
    github_list_milestones: () => [{ number: 1, title: "v1.0" }],
    github_list_issue_types: () => [{ name: "Bug" }],
    github_list_workflows: () => [
      { id: 7, name: "CI", path: ".github/workflows/ci.yml", state: "active" },
      { id: 8, name: "Old", path: ".github/workflows/old.yml", state: "deleted" },
    ],
    github_create_pull_request: ({ title }) => pullRequest(42, { title }),
    github_create_issue: ({ title }) => ({
      number: 13,
      title,
      state: "OPEN",
      author: { login: "ada" },
      updatedAt: "2026-10-10T00:00:00Z",
      url: "https://github.com/athasdev/athas/issues/13",
      labels: [],
    }),
    github_dispatch_workflow: () => null,
  };
  mockInvoke.mockReset();
  mockInvoke.mockImplementation(async (command, args) => {
    const handler = handlers[command];
    return handler ? handler((args ?? {}) as Record<string, any>) : null;
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
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

describe("GitHub create view", () => {
  describe("pull requests", () => {
    it("creates a draft pull request from the current branch into main", async () => {
      await render("pull-request", "feature/login");

      expect(view().getByText("New pull request")).toBeTruthy();
      expect(view().getByText("in repo")).toBeTruthy();
      expect(createButton().disabled).toBe(true);

      await typeInto(view().getByPlaceholderText("Pull request title"), "Add login");
      await typeInto(view().getByRole("textbox", { name: "Write a description..." }), "Body");
      await click(view().getByRole("checkbox"));
      await click(createButton());

      expect(calls("github_create_pull_request")).toEqual([
        {
          repoPath: "/repo",
          title: "Add login",
          body: "Body",
          head: "feature/login",
          base: "main",
          draft: true,
          labels: [],
          assignees: [],
        },
      ]);
      expect(mocks.buffer.closeBufferForce).toHaveBeenCalledWith("form-buffer");
      expect(mocks.buffer.openPRBuffer).toHaveBeenCalledWith(42, {
        title: "Add login",
        repoPath: "/repo",
        authorAvatarUrl: expect.any(String),
      });
      expect(mocks.toast.success).toHaveBeenCalledWith("Pull request created", {
        description: "#42 Add login",
      });
    });

    it("submits with Enter and shows a failed create", async () => {
      handlers.github_create_pull_request = () => {
        throw new Error("A pull request already exists");
      };
      await render("pull-request");

      const title = view().getByPlaceholderText("Pull request title");
      await typeInto(title, "Duplicate");
      await act(async () => {
        fireEvent.keyDown(title, { key: "Enter" });
      });
      await settle();

      expect(calls("github_create_pull_request")).toEqual([
        expect.objectContaining({ head: "main", base: "main" }),
      ]);
      expect(view().getByText("A pull request already exists")).toBeTruthy();
      expect(mocks.buffer.closeBufferForce).not.toHaveBeenCalled();
    });

    it("generates a draft from the branch diff", async () => {
      mocks.requestInlineEdit.mockResolvedValue({
        editedText: '```json\n{"title": "Add login flow", "body": "Adds the login screen."}\n```',
      });
      await render("pull-request", "feature/login");

      await click(view().getByRole("button", { name: "Generate" }));

      expect(calls("git_ref_diff")).toEqual([
        { repoPath: "/repo", baseRef: "main", targetRef: "feature/login" },
      ]);
      const prompt = mocks.requestInlineEdit.mock.calls[0][0];
      expect(prompt).toMatchObject({ model: "model-1", filePath: "github-pull-request" });
      expect(prompt.selectedText).toContain("+export const login = true;");
      expect(prompt.selectedText).toContain("modified staged: src/login.ts");
      expect((view().getByPlaceholderText("Pull request title") as HTMLInputElement).value).toBe(
        "Add login flow",
      );
      expect(
        (view().getByRole("textbox", { name: "Write a description..." }) as HTMLTextAreaElement)
          .value,
      ).toBe("Adds the login screen.");
      expect(mocks.toast.success).toHaveBeenCalledWith("PR draft generated");
    });

    it("reports an unusable generated draft", async () => {
      mocks.requestInlineEdit.mockResolvedValue({ editedText: "I cannot help with that" });
      await render("pull-request");

      await click(view().getByRole("button", { name: "Generate" }));

      expect(view().getByText("AI did not return a usable draft.")).toBeTruthy();
    });

    it("respects an organization policy that disables AI", async () => {
      useAuthStore.setState({
        subscription: {
          enterprise: { policy: { managedMode: true, aiCompletionEnabled: false } },
        } as never,
      });
      await render("pull-request");

      await click(view().getByRole("button", { name: "Generate" }));

      expect(
        view().getByText("AI generation is disabled by your organization policy."),
      ).toBeTruthy();
      expect(mocks.requestInlineEdit).not.toHaveBeenCalled();
    });
  });

  describe("issues", () => {
    it("creates an issue and opens it", async () => {
      await render("issue");

      expect(view().getByText("New issue")).toBeTruthy();
      expect(view().getByRole("combobox", { name: "Issue milestone" })).toBeTruthy();
      expect(view().getByRole("combobox", { name: "Issue type" })).toBeTruthy();
      await typeInto(view().getByPlaceholderText("Issue title"), "Crash on save");
      await click(createButton());

      expect(calls("github_create_issue")).toEqual([
        {
          repoPath: "/repo",
          title: "Crash on save",
          body: "",
          labels: [],
          assignees: [],
          milestone: null,
          issueType: null,
        },
      ]);
      expect(mocks.buffer.openGitHubIssueBuffer).toHaveBeenCalledWith({
        issueNumber: 13,
        repoPath: "/repo",
        title: "Crash on save",
        authorAvatarUrl: expect.any(String),
        url: "https://github.com/athasdev/athas/issues/13",
      });
      expect(mocks.toast.success).toHaveBeenCalledWith("Issue created", {
        description: "#13 Crash on save",
      });
    });

    it("generates an issue draft from plain JSON", async () => {
      mocks.requestInlineEdit.mockResolvedValue({ editedText: '{"title": "Crash on save"}' });
      await render("issue");

      await click(view().getByRole("button", { name: "Generate" }));

      expect(calls("git_ref_diff")).toEqual([]);
      expect(mocks.requestInlineEdit.mock.calls[0][0]).toMatchObject({ filePath: "github-issue" });
      expect((view().getByPlaceholderText("Issue title") as HTMLInputElement).value).toBe(
        "Crash on save",
      );
      expect(mocks.toast.success).toHaveBeenCalledWith("Issue draft generated");
    });

    it("cancels the form", async () => {
      await render("issue");

      await click(view().getByRole("button", { name: "Cancel" }));

      expect(mocks.buffer.closeBufferForce).toHaveBeenCalledWith("form-buffer");
    });
  });

  describe("workflows", () => {
    it("dispatches the first active workflow on the chosen ref", async () => {
      await render("action", "feature/login");

      expect(view().getAllByText("Run workflow").length).toBeGreaterThan(0);
      expect(calls("github_list_labels")).toEqual([]);
      await click(view().getByRole("button", { name: "Run workflow" }));

      expect(calls("github_dispatch_workflow")).toEqual([
        { repoPath: "/repo", workflowId: 7, reference: "feature/login" },
      ]);
      expect(mocks.toast.success).toHaveBeenCalledWith("Workflow queued");
      expect(mocks.buffer.closeBufferForce).toHaveBeenCalledWith("form-buffer");
    });

    it("shows a failure to list workflows", async () => {
      handlers.github_list_workflows = () => {
        throw new Error("workflows unavailable");
      };
      await render("action");

      expect(view().getByText("workflows unavailable")).toBeTruthy();
      expect(
        (view().getByRole("button", { name: "Run workflow" }) as HTMLButtonElement).disabled,
      ).toBe(true);
    });

    it("shows a failed dispatch", async () => {
      handlers.github_dispatch_workflow = () => {
        throw new Error("Workflow does not have workflow_dispatch trigger");
      };
      await render("action");

      await click(view().getByRole("button", { name: "Run workflow" }));

      expect(view().getByText("Workflow does not have workflow_dispatch trigger")).toBeTruthy();
    });
  });
});
