import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const env = vi.hoisted(() => ({
  buffers: [] as Array<Record<string, unknown>>,
  openBuffer: vi.fn(() => "opened-buffer"),
  setActiveBuffer: vi.fn(),
  requestReveal: vi.fn(),
  readFileContent: vi.fn(),
  detached: false,
  activePaneId: "chat-pane",
  chatPane: { id: "chat-pane", activeBufferId: "agent-buffer", bufferIds: ["agent-buffer"] },
  scope: [] as Array<{ id: string; bufferIds: string[]; locked?: boolean }>,
  setActivePane: vi.fn(),
  ensureBufferInPane: vi.fn(),
  createPaneBeside: vi.fn(() => "new-pane"),
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
vi.mock("@/features/ai/detached/stores/agent-window.store", () => ({
  agentIsDetached: () => env.detached,
}));
vi.mock("@/features/ai/lib/open-tool-location", () => ({
  resolveToolPath: async (path: string) => (path.startsWith("/") ? path : `/repo/${path}`),
}));
vi.mock("@/features/editor/stores/buffer.store", () => ({
  useBufferStore: {
    getState: () => ({
      buffers: env.buffers,
      actions: { openBuffer: env.openBuffer, setActiveBuffer: env.setActiveBuffer },
    }),
  },
}));
vi.mock("@/features/editor/stores/state.store", () => ({
  useEditorStateStore: { getState: () => ({ actions: { requestReveal: env.requestReveal } }) },
}));
vi.mock("@/features/file-system/api/file-operations", () => ({
  readFileContent: env.readFileContent,
}));
vi.mock("@/features/panes/stores/pane.store", () => ({
  usePaneStore: {
    getState: () => ({
      root: {},
      bottomRoot: null,
      mostRecentActivePaneIds: ["other-pane"],
      actions: {
        getPaneByBufferId: (bufferId: string) =>
          bufferId === "agent-buffer" ? env.chatPane : null,
        getActivePane: () => ({ id: env.activePaneId }),
        setActivePane: env.setActivePane,
      },
    }),
  },
}));
vi.mock("@/features/panes/services/pane-buffer-actions", () => ({
  ensureBufferInPane: env.ensureBufferInPane,
}));
vi.mock("@/features/panes/services/pane-routing", () => ({
  getPaneScopeForPaneId: () => env.scope,
}));
vi.mock("@/features/panes/services/pane-split-actions", () => ({
  createPaneBeside: env.createPaneBeside,
}));

import { enableMapSet } from "immer";
import {
  followAgentLocations,
  followAgentTo,
  stopFollowingAgent,
  toggleFollowAgent,
} from "../services/agent-follow-service";
import { isFollowingAgent } from "../stores/agent-follow.store";
import { useAIChatStore } from "../stores/ai-chat.store";

enableMapSet();

let chatId: string;
let runCounter = 0;
const flush = () => vi.advanceTimersByTimeAsync(300);

function startRun() {
  runCounter += 1;
  useAIChatStore.getState().actions.startAgentRun(chatId, {
    runId: `run-${runCounter}`,
    assistantMessageId: "a",
    agentId: "claude-code",
    phase: "tool",
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  env.detached = false;
  env.activePaneId = "chat-pane";
  env.scope = [
    { id: "chat-pane", bufferIds: ["agent-buffer"] },
    { id: "other-pane", bufferIds: [] },
  ];
  env.readFileContent.mockResolvedValue("file text");
  chatId = useAIChatStore.getState().actions.createNewChat("claude-code");
  env.buffers = [{ id: "agent-buffer", type: "agent", sessionId: chatId }];
  toggleFollowAgent(chatId);
  startRun();
});

afterEach(() => {
  stopFollowingAgent(chatId);
  vi.useRealTimers();
});

describe("following the agent", () => {
  it("opens the file the agent works in beside the chat and reveals the line", async () => {
    followAgentTo(chatId, { path: "src/app.ts", line: 12 });
    await flush();

    expect(env.readFileContent).toHaveBeenCalledWith("/repo/src/app.ts");
    expect(env.setActivePane).toHaveBeenCalledWith("other-pane");
    expect(env.openBuffer.mock.calls[0].slice(0, 3)).toEqual([
      "/repo/src/app.ts",
      "app.ts",
      "file text",
    ]);
    expect(env.setActiveBuffer).toHaveBeenCalledWith("agent-buffer");
    expect(env.requestReveal).toHaveBeenCalledWith({ bufferId: "opened-buffer", line: 12 });
  });

  it("reuses an open editor tab without reading the file again", async () => {
    env.buffers.push({ id: "editor-1", type: "editor", path: "/repo/b.ts" });
    env.scope.push({ id: "showing-pane", bufferIds: ["editor-1"] });

    followAgentLocations(chatId, [{ path: "/repo/b.ts" }]);
    await flush();

    expect(env.readFileContent).not.toHaveBeenCalled();
    expect(env.ensureBufferInPane).toHaveBeenCalledWith("showing-pane", "editor-1", true);
    expect(env.requestReveal).not.toHaveBeenCalled();
  });

  it("splits the chat's pane when there is nowhere else to show the file", async () => {
    env.scope = [{ id: "chat-pane", bufferIds: ["agent-buffer"] }];
    followAgentTo(chatId, { path: "/repo/c.ts", line: null });
    await flush();
    expect(env.createPaneBeside).toHaveBeenCalledWith("chat-pane", "horizontal", "after");
    expect(env.setActivePane).toHaveBeenCalledWith("new-pane");
  });

  it("skips files that are not text and files it cannot read", async () => {
    followAgentTo(chatId, { path: "/repo/logo.png", line: null });
    await flush();
    startRun();
    env.readFileContent.mockRejectedValueOnce(new Error("EACCES"));
    followAgentTo(chatId, { path: "/repo/secret.ts", line: null });
    await flush();

    expect(env.readFileContent).toHaveBeenCalledWith("/repo/secret.ts");
    expect(env.openBuffer).not.toHaveBeenCalled();
  });

  it("does not move the editor when the chat is hidden, detached or idle", async () => {
    env.activePaneId = "other-pane";
    followAgentTo(chatId, { path: "/repo/a.ts", line: null });
    await flush();

    env.activePaneId = "chat-pane";
    env.detached = true;
    startRun();
    followAgentTo(chatId, { path: "/repo/b.ts", line: null });
    await flush();

    env.detached = false;
    useAIChatStore.getState().actions.finishAgentRun(chatId, `run-${runCounter}`);
    followAgentTo(chatId, { path: "/repo/c.ts", line: null });
    await flush();

    expect(env.readFileContent).not.toHaveBeenCalled();
    expect(env.openBuffer).not.toHaveBeenCalled();
  });

  it("ignores repeats and jumps to the latest location once per interval", async () => {
    followAgentTo(chatId, { path: "/repo/a.ts", line: 1 });
    followAgentTo(chatId, { path: "/repo/a.ts", line: 1 });
    followAgentTo(chatId, { path: "/repo/b.ts", line: 2 });
    followAgentTo(chatId, { path: "/repo/c.ts", line: 3 });
    await flush();
    expect(env.readFileContent.mock.calls.map(([path]) => path)).toEqual([
      "/repo/a.ts",
      "/repo/c.ts",
    ]);
  });

  it("stops when following is turned off", async () => {
    expect(toggleFollowAgent(chatId)).toBe(false);
    expect(isFollowingAgent(chatId)).toBe(false);
    followAgentTo(chatId, { path: "/repo/a.ts", line: null });
    followAgentLocations(chatId, []);
    await flush();
    expect(env.readFileContent).not.toHaveBeenCalled();

    expect(toggleFollowAgent(chatId)).toBe(true);
  });
});
