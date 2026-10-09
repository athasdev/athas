// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const buffers = vi.hoisted(() => ({
  store: null as unknown as { setState: (state: { buffers: unknown[] }) => void },
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
  agentIsDetached: () => false,
}));
vi.mock("@/features/editor/stores/buffer.store", async () => {
  const { create } = await import("zustand");
  const store = create(() => ({ buffers: [] as unknown[] }));
  buffers.store = store;
  return { useBufferStore: store };
});

import { enableMapSet } from "immer";
import { commands } from "@/bindings/commands";
import { useAgentTabSessionRelease } from "../hooks/use-agent-tab-session-release";
import { useAIChatStore } from "../stores/ai-chat.store";

enableMapSet();

let root: Root;
let chatId: string;

function Harness() {
  useAgentTabSessionRelease();
  return null;
}

const tab = (sessionId: string) => ({ id: `tab-${sessionId}`, type: "agent", sessionId });

function closeTabs() {
  act(() => buffers.store.setState({ buffers: [] }));
}

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.restoreAllMocks();
  vi.spyOn(commands, "closeAcpSession").mockResolvedValue(undefined as never);
  const actions = useAIChatStore.getState().actions;
  chatId = actions.createNewChat("claude-code");
  actions.setChatAcpSessionId(chatId, `sess-${chatId}`);
  useAIChatStore.setState({
    acpAgents: {
      claude: {
        agentId: "claude-code",
        running: true,
        sessionIds: [`sess-${chatId}`],
        agentCapabilities: { loadSession: true, sessionCapabilities: { close: {} } },
      } as never,
    },
    acpSessions: { [`sess-${chatId}`]: {} as never },
  });
  buffers.store.setState({ buffers: [tab(chatId)] });
  root = createRoot(document.createElement("div"));
  await act(async () => root.render(createElement(Harness)));
});

afterEach(async () => {
  await act(async () => root.unmount());
});

describe("useAgentTabSessionRelease", () => {
  it("closes the chat's agent session when its last tab closes", () => {
    closeTabs();
    expect(commands.closeAcpSession).toHaveBeenCalledWith(`sess-${chatId}`);
    expect(useAIChatStore.getState().acpSessions[`sess-${chatId}`]).toBeUndefined();
  });

  it("keeps the session while the agent is still working", () => {
    useAIChatStore.getState().actions.startAgentRun(chatId, {
      runId: "r",
      assistantMessageId: "a",
      agentId: "claude-code",
      phase: "waiting",
    });
    closeTabs();
    expect(commands.closeAcpSession).not.toHaveBeenCalled();
  });

  it("keeps sessions the agent could not bring back", () => {
    useAIChatStore.setState({
      acpAgents: {
        claude: {
          agentId: "claude-code",
          running: true,
          sessionIds: [`sess-${chatId}`],
          agentCapabilities: {},
        } as never,
      },
    });
    closeTabs();
    expect(commands.closeAcpSession).not.toHaveBeenCalled();
  });

  it("ignores unrelated buffer changes and logs a failed close", () => {
    act(() => buffers.store.setState({ buffers: [tab(chatId), { id: "e", type: "editor" }] }));
    expect(commands.closeAcpSession).not.toHaveBeenCalled();

    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(commands.closeAcpSession).mockRejectedValue(new Error("gone"));
    closeTabs();
    return vi.waitFor(() =>
      expect(error).toHaveBeenCalledWith(
        "Failed to close the agent session of a closed tab:",
        expect.any(Error),
      ),
    );
  });
});
