// @vitest-environment jsdom
import { fireEvent, waitFor } from "@testing-library/dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const io = vi.hoisted(() => ({
  runs: [] as Array<Record<string, unknown>>,
  logs: [] as Array<{ at: number; stream: string; text: string }>,
  branches: { defaultBranch: "main", branches: ["main", "feature"] } as Record<string, unknown>,
  reposStatus: 200,
  opened: [] as string[],
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "main" }),
  getAllWebviewWindows: async () => [],
}));
vi.mock("@/features/ai/services/ai-chat-history-service", () => ({
  deleteChatFromDb: vi.fn(),
  initChatDatabase: vi.fn(),
  loadAllChatsFromDb: vi.fn(),
  loadChatFromDb: vi.fn(),
  saveChatMetadataToDb: vi.fn().mockResolvedValue(undefined),
  saveChatToDb: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/features/github/services/project-github-repository", () => ({
  resolveProjectGitHubRepository: async () => ({ owner: "athasdev", repo: "athas" }),
}));
vi.mock("@/utils/external-url", () => ({
  openExternalUrl: async (url: string) => {
    io.opened.push(url);
  },
}));
vi.mock("@/features/auth/services/auth-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/auth/services/auth-api")>()),
  authenticatedFetch: async (path: string) => {
    const url = new URL(path, "https://athas.test");
    if (url.pathname === "/api/cloud-agents/runs") return Response.json({ runs: io.runs });
    if (url.pathname === "/api/cloud-agents/repos") {
      return io.reposStatus === 200
        ? Response.json({
            repos: [
              { fullName: "athasdev/athas", defaultBranch: "main", private: false, pushedAt: null },
              { fullName: "me/other", defaultBranch: "trunk", private: true, pushedAt: null },
            ],
          })
        : Response.json(
            { error: "Connect GitHub", code: "github_not_connected" },
            { status: io.reposStatus },
          );
    }
    if (url.pathname === "/api/cloud-workspaces/branches") return Response.json(io.branches);
    if (url.pathname.endsWith("/logs")) {
      const after = Number(url.searchParams.get("after") ?? 0);
      return Response.json({ lines: io.logs.slice(after), cursor: io.logs.length });
    }
    return Response.json({ error: "Not found" }, { status: 404 });
  },
}));

import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { useAuthStore } from "@/features/auth/stores/auth.store";
import { useGitStore } from "@/features/git/stores/git.store";
import { useProjectStore } from "@/features/workspace/stores/project.store";
import { queryClient } from "@/utils/query-client";
import { CloudComposerNotice } from "../components/cloud-composer-notice";
import { CloudRunCard } from "../components/cloud-run-card";
import { CloudSessionSync } from "../components/cloud-session-sync";
import { ComposerEnvironmentControls } from "../components/composer-environment-controls";
import { useAgentEnvironment } from "../hooks/use-agent-environment";
import { useCloudTargets } from "../hooks/use-cloud-targets";
import { useCloudEnvironmentStore } from "../stores/cloud-environment.store";

let root: Root;
let container: HTMLDivElement;

function setCloudAgents(enabled: boolean) {
  useAuthStore.setState({
    subscription: enabled
      ? ({ status: "pro", capabilities: { cloudAgents: true } } as never)
      : ({ status: "pro", capabilities: { cloudAgents: false } } as never),
  });
}

async function render(node: ReactNode) {
  await act(async () =>
    root.render(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>),
  );
  await act(async () => {});
}

function Composer({
  chatId = null,
  agentId = "claude-acp",
  onAgentChange,
}: {
  chatId?: string | null;
  agentId?: string;
  onAgentChange?: (agentId: string) => void;
}) {
  const environment = useAgentEnvironment({ chatId, draftKey: "surface" });
  const targets = useCloudTargets(environment, "/work/athas");
  return (
    <div>
      <CloudComposerNotice
        environment={environment}
        targets={targets}
        currentAgentId={agentId}
        onAgentChange={onAgentChange}
      />
      <ComposerEnvironmentControls environment={environment} targets={targets} />
    </div>
  );
}

function makeRun(patch: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    repo: "athasdev/athas",
    baseBranch: "main",
    branch: "athas/fix-dates",
    title: "Fix the date parser",
    agent: "claude-code",
    status: "running",
    pool: "included_allowance",
    maxMinutes: 60,
    billedSeconds: 0,
    chargedCents: 0,
    holdCents: 0,
    prUrl: null,
    error: null,
    createdAt: new Date().toISOString(),
    startedAt: new Date(Date.now() - 65_000).toISOString(),
    finishedAt: null,
    billing: "athas",
    spentMicros: 120_000,
    spendCapMicros: 5_000_000,
    ...patch,
  };
}

function seedCloudChat() {
  const chatId = "cloud-chat";
  const now = new Date();
  useAIChatStore.setState({
    chats: [
      {
        id: chatId,
        title: "Fix the date parser",
        createdAt: now,
        lastMessageAt: now,
        agentId: "claude-acp",
        workspacePath: "/work/athas",
        messageCount: 2,
        sessionSettings: {
          cloud: {
            repo: "athasdev/athas",
            branch: "main",
            runs: [{ messageId: "reply", runId: "run-1" }],
          },
        },
      },
    ],
    messagesByChat: {
      [chatId]: [
        { id: "prompt", role: "user", content: "Fix the date parser", timestamp: now },
        { id: "reply", role: "assistant", content: "", timestamp: now },
      ],
    },
    chatMessageLoadStates: { [chatId]: "loaded" },
  });
  return chatId;
}

const reply = () =>
  useAIChatStore.getState().messagesByChat["cloud-chat"]?.find((message) => message.id === "reply");

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  io.runs = [];
  io.logs = [];
  io.opened = [];
  io.reposStatus = 200;
  io.branches = { defaultBranch: "main", branches: ["main", "feature"] };
  queryClient.clear();
  useAIChatStore.setState({ chats: [], messagesByChat: {}, chatMessageLoadStates: {} });
  useCloudEnvironmentStore.setState({
    drafts: {},
    logs: {},
    preferences: { useOwnKey: false, maxMinutes: 60 },
  });
  useProjectStore.setState({ rootFolderPath: "/work/athas" });
  useGitStore.setState({ gitStatus: { branch: "feature", ahead: 0, behind: 0, files: [] } });
  setCloudAgents(true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  queryClient.clear();
});

describe("composer environment", () => {
  it("is hidden for accounts without cloud agents", async () => {
    setCloudAgents(false);
    await render(<Composer />);
    expect(container.querySelector('[aria-label^="Runs:"]')).toBeNull();
  });

  it("switches a draft to Cloud and defaults the repository and branch from the project", async () => {
    await render(<Composer />);
    expect(container.querySelector('[aria-label="Runs: Local"]')).not.toBeNull();
    expect(container.querySelector('[aria-label^="Repository"]')).toBeNull();

    await act(async () =>
      useCloudEnvironmentStore.getState().actions.updateDraft("surface", { kind: "cloud" }),
    );
    await waitFor(() =>
      expect(useCloudEnvironmentStore.getState().drafts.surface).toEqual({
        kind: "cloud",
        repo: "athasdev/athas",
        branch: "feature",
      }),
    );
    await waitFor(() =>
      expect(container.querySelector('[aria-label="Branch: feature"]')).not.toBeNull(),
    );
    expect(container.querySelector('[aria-label="Runs: Cloud"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Repository: athasdev/athas"]')).not.toBeNull();
  });

  it("keeps the time limit and own-key choice in the environment menu", async () => {
    useCloudEnvironmentStore.getState().actions.updateDraft("surface", { kind: "cloud" });
    await render(<Composer />);
    const trigger = container.querySelector<HTMLButtonElement>('[aria-label="Runs: Cloud"]')!;
    await act(async () => {
      fireEvent.pointerDown(trigger, { button: 0, pointerType: "mouse" });
      fireEvent.mouseDown(trigger, { button: 0 });
      fireEvent.click(trigger);
    });
    await waitFor(() => expect(document.body.textContent).toContain("Use my own API key"));
    expect(document.body.textContent).toContain("Time limit");
    const ownKey = [...document.body.querySelectorAll('[role="menuitemcheckbox"]')].find((item) =>
      item.textContent?.includes("Use my own API key"),
    )!;
    await act(async () => fireEvent.click(ownKey));
    expect(useCloudEnvironmentStore.getState().preferences.useOwnKey).toBe(true);
  });

  it("starts from the default branch when the checked-out one was never pushed", async () => {
    useGitStore.setState({ gitStatus: { branch: "local-only", ahead: 0, behind: 0, files: [] } });
    useCloudEnvironmentStore.getState().actions.updateDraft("surface", { kind: "cloud" });
    await render(<Composer />);
    await waitFor(() =>
      expect(useCloudEnvironmentStore.getState().drafts.surface?.branch).toBe("main"),
    );
  });

  it("offers Claude Code for an agent that cannot run in the cloud", async () => {
    const onAgentChange = vi.fn();
    useCloudEnvironmentStore.getState().actions.updateDraft("surface", { kind: "cloud" });
    await render(<Composer agentId="gemini-cli" onAgentChange={onAgentChange} />);
    expect(container.textContent).toContain("Cloud runs use Claude Code or Codex");
    fireEvent.click(
      [...container.querySelectorAll("button")].find(
        (button) => button.textContent === "Use Claude Code",
      )!,
    );
    expect(onAgentChange).toHaveBeenCalledWith("claude-acp");
  });

  it("asks to connect GitHub when the server cannot list repositories", async () => {
    io.reposStatus = 409;
    useCloudEnvironmentStore.getState().actions.updateDraft("surface", { kind: "cloud" });
    await render(<Composer />);
    await waitFor(() => expect(container.textContent).toContain("Connect GitHub"));
    fireEvent.click(
      [...container.querySelectorAll("button")].find(
        (button) => button.textContent === "Connect GitHub",
      )!,
    );
    expect(io.opened[0]).toContain("/dashboard/settings/integrations");
  });

  it("keeps a session's choice in the session, and locks it once the session has started", async () => {
    const chatId = seedCloudChat();
    await render(<Composer chatId={chatId} />);
    const environment = container.querySelector<HTMLButtonElement>('[aria-label="Runs: Cloud"]');
    expect(environment?.disabled).toBe(true);
    expect(container.querySelector('[aria-label^="Repository"]')).toBeNull();
  });
});

describe("cloud session timeline", () => {
  it("writes the run's log into its reply while it works, and settles it when it ends", async () => {
    io.runs = [makeRun()];
    io.logs = [
      { at: 1, stream: "system", text: "Cloning athasdev/athas" },
      {
        at: 2,
        stream: "stdout",
        text: JSON.stringify({
          type: "assistant",
          message: {
            content: [
              { type: "text", text: "Looking at the parser." },
              { type: "tool_use", id: "t1", name: "Bash", input: { command: "bun test" } },
            ],
          },
        }),
      },
    ];
    const chatId = seedCloudChat();
    await render(
      <>
        <CloudSessionSync chatId={chatId} />
        <CloudRunCard chatId={chatId} messageId="reply" />
      </>,
    );
    await waitFor(() => expect(reply()?.content).toBe("Looking at the parser."));
    expect(reply()).toMatchObject({ isStreaming: true });
    expect(reply()?.toolCalls?.[0]).toMatchObject({ name: "Bash", status: "in_progress" });
    expect(container.textContent).toContain("Working in the cloud");
    expect(container.querySelector("button")?.textContent).toContain("Log");
    expect(container.textContent).toContain("Stop");

    io.runs = [
      makeRun({
        status: "succeeded",
        prUrl: "https://github.com/athasdev/athas/pull/42",
        billedSeconds: 312,
        finishedAt: new Date().toISOString(),
      }),
    ];
    await act(async () => {
      await queryClient.invalidateQueries();
    });
    await waitFor(() => expect(reply()?.isStreaming).toBe(false));
    await waitFor(() => expect(container.textContent).toContain("Open on GitHub"));
    expect(container.textContent).toContain("athasdev/athas #42");
    expect(container.textContent).toContain("5m 12s in the sandbox");
    expect(container.textContent).toContain("$0.12 credit");
    fireEvent.click(
      [...container.querySelectorAll("button")].find((button) =>
        button.textContent?.includes("Open on GitHub"),
      )!,
    );
    expect(io.opened).toEqual(["https://github.com/athasdev/athas/pull/42"]);
  });

  it("shows why a run could not start, with the action that fixes it", async () => {
    const chatId = seedCloudChat();
    useAIChatStore.getState().actions.setChatCloudEnvironment(chatId, {
      repo: "athasdev/athas",
      branch: "main",
      runs: [
        {
          messageId: "reply",
          runId: null,
          error: { message: "No credit left.", code: "allowance_exhausted" },
        },
      ],
    });
    await render(<CloudRunCard chatId={chatId} messageId="reply" />);
    expect(container.textContent).toContain("Out of Athas credit");
    fireEvent.click(
      [...container.querySelectorAll("button")].find(
        (button) => button.textContent === "Add credit",
      )!,
    );
    expect(io.opened[0]).toContain("/dashboard/settings/billing");
  });
});
