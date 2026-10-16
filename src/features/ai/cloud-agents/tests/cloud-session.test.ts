import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const io = vi.hoisted(() => ({
  posts: [] as Array<Record<string, unknown>>,
  startFailure: null as null | { status: number; body: Record<string, unknown> },
  cancelled: [] as string[],
  keys: {} as Record<string, string>,
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
vi.mock("@/features/ai/services/ai-token-service", () => ({
  getProviderApiToken: async (providerId: string) => io.keys[providerId] ?? null,
}));
vi.mock("@/features/ai/services/open-agent-history", () => ({
  openAgentHistoryChat: (chatId: string) => {
    io.opened.push(chatId);
    return chatId;
  },
}));
vi.mock("@/features/ai/detached/services/agent-window-service", () => ({
  openAgentWindowSession: () => null,
}));
vi.mock("@/features/editor/stores/buffer.store", () => ({
  useBufferStore: {
    getState: () => ({
      actions: {
        openAgentBuffer: (chatId: string) => {
          io.opened.push(chatId);
          return `buffer-${chatId}`;
        },
      },
    }),
  },
}));
vi.mock("@/features/auth/services/auth-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/auth/services/auth-api")>()),
  authenticatedFetch: async (path: string, init?: RequestInit) => {
    const url = new URL(path, "https://athas.test");
    if (url.pathname === "/api/cloud-agents/runs" && init?.method === "POST") {
      if (io.startFailure)
        return Response.json(io.startFailure.body, { status: io.startFailure.status });
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      io.posts.push(body);
      return Response.json(
        {
          run: makeRun(`run-${io.posts.length}`, {
            status: "queued",
            baseBranch: String(body.baseBranch),
          }),
        },
        { status: 201 },
      );
    }
    const cancel = url.pathname.match(/^\/api\/cloud-agents\/runs\/([^/]+)\/cancel$/);
    if (cancel) {
      io.cancelled.push(cancel[1]!);
      return Response.json({ run: makeRun(cancel[1]!, { status: "cancelled" }) });
    }
    if (url.pathname === "/api/cloud-agents/runs") return Response.json({ runs: [] });
    return Response.json({ error: "Not found" }, { status: 404 });
  },
}));

import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { queryClient } from "@/utils/query-client";
import type { CloudAgentRun } from "../services/cloud-agents-api";
import { cloudAgentKeys } from "../services/cloud-agents-queries";
import {
  cancelCloudRun,
  getCloudSendBlocker,
  openCloudRunSession,
  openNewCloudAgentChat,
  retryCloudRun,
  setChatCloudTarget,
  setChatEnvironmentKind,
  startCloudSessionRun,
} from "../services/cloud-session";
import { useCloudEnvironmentStore } from "../stores/cloud-environment.store";

function makeRun(id: string, patch: Partial<CloudAgentRun> = {}): CloudAgentRun {
  return {
    id,
    repo: "athasdev/athas",
    baseBranch: "main",
    branch: `athas/${id}`,
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
    createdAt: "2026-10-15T10:00:00Z",
    startedAt: "2026-10-15T10:00:05Z",
    finishedAt: null,
    ...patch,
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const chatOf = (chatId: string) =>
  useAIChatStore.getState().chats.find((chat) => chat.id === chatId)!;
const messagesOf = (chatId: string) => useAIChatStore.getState().messagesByChat[chatId] ?? [];

function cloudChat(agentId = "claude-acp") {
  const { actions } = useAIChatStore.getState();
  const chatId = actions.createNewChat(agentId, { activate: false });
  setChatEnvironmentKind(chatId, "cloud");
  setChatCloudTarget(chatId, { repo: "athasdev/athas", branch: "main" });
  return chatId;
}

function setCachedRun(run: CloudAgentRun) {
  queryClient.setQueryData<CloudAgentRun[]>(cloudAgentKeys.runs(), (runs) => [
    run,
    ...(runs ?? []).filter((candidate) => candidate.id !== run.id),
  ]);
}

beforeEach(() => {
  io.posts = [];
  io.startFailure = null;
  io.cancelled = [];
  io.keys = {};
  io.opened = [];
  useAIChatStore.setState({ chats: [], messagesByChat: {}, chatMessageLoadStates: {} });
  useCloudEnvironmentStore.setState({
    drafts: {},
    logs: {},
    preferences: { useOwnKey: false, maxMinutes: 60 },
  });
  queryClient.clear();
});

afterEach(() => queryClient.clear());

describe("cloud environment per session", () => {
  it("keeps Local or Cloud, the repository and the branch in the session", () => {
    const { actions } = useAIChatStore.getState();
    const chatId = actions.createNewChat("claude-acp", { activate: false });
    expect(chatOf(chatId).sessionSettings?.cloud).toBeUndefined();

    setChatEnvironmentKind(chatId, "cloud");
    expect(chatOf(chatId).sessionSettings?.cloud).toEqual({ repo: null, branch: null, runs: [] });

    setChatCloudTarget(chatId, { repo: "athasdev/athas", branch: "feature" });
    setChatCloudTarget(chatId, { repo: "me/other" });
    expect(chatOf(chatId).sessionSettings?.cloud).toMatchObject({ repo: "me/other", branch: null });

    setChatEnvironmentKind(chatId, "local");
    expect(chatOf(chatId).sessionSettings?.cloud).toBeUndefined();
  });

  it("keeps a session with runs in the cloud", () => {
    const chatId = cloudChat();
    startCloudSessionRun(chatId, "Fix it");
    setChatEnvironmentKind(chatId, "local");
    expect(chatOf(chatId).sessionSettings?.cloud?.runs).toHaveLength(1);
  });

  it("keeps a draft for a composer without a session", () => {
    const { updateDraft } = useCloudEnvironmentStore.getState().actions;
    updateDraft("composer", { kind: "cloud" });
    updateDraft("composer", { repo: "athasdev/athas", branch: "main" });
    expect(useCloudEnvironmentStore.getState().drafts["composer"]).toEqual({
      kind: "cloud",
      repo: "athasdev/athas",
      branch: "main",
    });
  });

  it("opens the Cloud Agents command as a new cloud session", () => {
    useAIChatStore.setState({ selectedAgentId: "gemini-cli" });
    openNewCloudAgentChat();
    const [chat] = useAIChatStore.getState().chats;
    expect(chat).toMatchObject({ agentId: "claude-acp" });
    expect(chat!.sessionSettings?.cloud).toEqual({ repo: null, branch: null, runs: [] });
    expect(io.opened).toEqual([chat!.id]);
  });
});

describe("cloud run lifecycle", () => {
  it("starts a run on Athas credit as the session's next turn", async () => {
    const chatId = cloudChat();
    expect(startCloudSessionRun(chatId, "Fix the date parser")).toEqual({ accepted: true });

    const [prompt, reply] = messagesOf(chatId);
    expect(prompt).toMatchObject({ role: "user", content: "Fix the date parser" });
    expect(reply).toMatchObject({
      role: "assistant",
      isStreaming: true,
      responsePhase: "starting",
    });
    expect(chatOf(chatId).title).toBe("Fix the date parser");
    expect(chatOf(chatId).sessionSettings?.cloud?.runs).toEqual([
      { messageId: reply!.id, runId: null },
    ]);

    await flush();
    await flush();
    expect(io.posts).toEqual([
      {
        repo: "athasdev/athas",
        baseBranch: "main",
        prompt: "Fix the date parser",
        agent: "claude-code",
        maxMinutes: 60,
      },
    ]);
    expect(chatOf(chatId).sessionSettings?.cloud?.runs[0]).toEqual({
      messageId: reply!.id,
      runId: "run-1",
      error: null,
    });
    expect(
      queryClient.getQueryData<CloudAgentRun[]>(cloudAgentKeys.runs())?.map((run) => run.id),
    ).toEqual(["run-1"]);
  });

  it("sends the user's own key only when they chose it", async () => {
    useCloudEnvironmentStore.getState().actions.setPreferences({ useOwnKey: true, maxMinutes: 30 });
    io.keys = { openai: "sk-openai-key" };
    const chatId = cloudChat("codex");
    startCloudSessionRun(chatId, "Add tests");
    await flush();
    await flush();
    expect(io.posts[0]).toMatchObject({
      agent: "codex",
      maxMinutes: 30,
      credentials: { openaiApiKey: "sk-openai-key" },
    });

    const claudeChat = cloudChat();
    startCloudSessionRun(claudeChat, "Add tests");
    await flush();
    await flush();
    expect(chatOf(claudeChat).sessionSettings?.cloud?.runs[0]?.error).toMatchObject({
      code: "missing_credentials",
    });
  });

  it("records why the server refused a run, and sends it again on retry", async () => {
    io.startFailure = {
      status: 402,
      body: { error: "You are out of credit.", code: "allowance_exhausted" },
    };
    const chatId = cloudChat();
    startCloudSessionRun(chatId, "Fix it");
    await flush();
    await flush();
    const reply = messagesOf(chatId)[1]!;
    expect(chatOf(chatId).sessionSettings?.cloud?.runs[0]).toEqual({
      messageId: reply.id,
      runId: null,
      error: { message: "You are out of credit.", code: "allowance_exhausted" },
    });
    expect(messagesOf(chatId)[1]).toMatchObject({ isStreaming: false });
    expect(getCloudSendBlocker(chatId)).toBeNull();

    io.startFailure = null;
    retryCloudRun(chatId, reply.id);
    await flush();
    await flush();
    expect(io.posts).toHaveLength(1);
    expect(chatOf(chatId).sessionSettings?.cloud?.runs[0]).toMatchObject({
      runId: "run-1",
      error: null,
    });
  });

  it("waits for a working run, then continues from its pull request's branch", async () => {
    const chatId = cloudChat();
    startCloudSessionRun(chatId, "First task");
    await flush();
    await flush();
    expect(startCloudSessionRun(chatId, "Second task")).toMatchObject({
      accepted: false,
      error: expect.stringContaining("still working"),
    });

    setCachedRun(
      makeRun("run-1", {
        status: "succeeded",
        prUrl: "https://github.com/athasdev/athas/pull/7",
      }),
    );
    expect(startCloudSessionRun(chatId, "Second task")).toEqual({ accepted: true });
    await flush();
    await flush();
    expect(io.posts[1]).toMatchObject({ prompt: "Second task", baseBranch: "athas/run-1" });
    expect(chatOf(chatId).sessionSettings?.cloud?.runs.map((run) => run.runId)).toEqual([
      "run-1",
      "run-2",
    ]);
    expect(messagesOf(chatId).map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
  });

  it("stops a run", async () => {
    setCachedRun(makeRun("run-9"));
    const run = await cancelCloudRun("run-9");
    expect(io.cancelled).toEqual(["run-9"]);
    expect(run.status).toBe("cancelled");
    expect(queryClient.getQueryData<CloudAgentRun[]>(cloudAgentKeys.runs())?.[0]?.status).toBe(
      "cancelled",
    );
  });

  it("says what is missing before it sends anything", () => {
    const { actions } = useAIChatStore.getState();
    const gemini = actions.createNewChat("gemini-cli", { activate: false });
    setChatEnvironmentKind(gemini, "cloud");
    expect(startCloudSessionRun(gemini, "x").error).toContain("Claude Code or Codex");

    const noRepo = actions.createNewChat("claude-acp", { activate: false });
    setChatEnvironmentKind(noRepo, "cloud");
    expect(startCloudSessionRun(noRepo, "x").error).toContain("repository");
    expect(messagesOf(noRepo)).toEqual([]);
    expect(io.posts).toEqual([]);
  });
});

describe("cloud sessions from elsewhere", () => {
  it("opens a run started on another device as a session, once", () => {
    const run = makeRun("remote", {
      repo: "me/other",
      baseBranch: "main",
      title: "Upgrade React",
      prompt: "Upgrade React to 19",
      status: "succeeded",
      prUrl: "https://github.com/me/other/pull/3",
    });
    openCloudRunSession(run, null);
    const [chat] = useAIChatStore.getState().chats;
    expect(chat).toMatchObject({
      title: "Upgrade React",
      agentId: "claude-acp",
      workspacePath: "github://me/other",
    });
    expect(messagesOf(chat!.id).map((message) => [message.role, message.content])).toEqual([
      ["user", "Upgrade React to 19"],
      ["assistant", ""],
    ]);
    expect(chat!.sessionSettings?.cloud).toEqual({
      repo: "me/other",
      branch: "main",
      runs: [{ messageId: messagesOf(chat!.id)[1]!.id, runId: "remote" }],
    });

    openCloudRunSession(run, "/work/other");
    expect(useAIChatStore.getState().chats).toHaveLength(1);
    expect(io.opened).toEqual([chat!.id, chat!.id]);
  });
});
