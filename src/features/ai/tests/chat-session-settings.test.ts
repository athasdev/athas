// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { invoke } from "@tauri-apps/api/core";
import {
  getConfigOptionsToRestore,
  getModeToRestore,
  parseChatSessionSettings,
  withSessionSetting,
} from "@/features/ai/lib/chat-session-settings";
import { saveChatMetadataToDb } from "@/features/ai/services/ai-chat-history-service";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import type { SessionConfigOption } from "@/features/ai/types/acp.types";
import type { Chat } from "@/features/ai/types/ai-chat.types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
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

const modelOption: SessionConfigOption = {
  id: "model",
  name: "Model",
  kind: {
    type: "select",
    currentValue: "slow",
    options: [
      { id: "slow", name: "Slow" },
      { id: "fast", name: "Fast" },
    ],
  },
};
const thinkingOption: SessionConfigOption = {
  id: "thinking",
  name: "Thinking",
  kind: { type: "boolean", currentValue: false },
};

describe("chat session settings", () => {
  it("reads saved settings and ignores anything malformed", () => {
    expect(parseChatSessionSettings('{"modeId":"plan","configOptions":{"a":"b","c":1}}')).toEqual({
      modeId: "plan",
      configOptions: { a: "b" },
    });
    expect(parseChatSessionSettings('{"followAgent":false,"modeId":3}')).toEqual({
      followAgent: false,
    });
    expect(parseChatSessionSettings("not json")).toBeNull();
    expect(parseChatSessionSettings(null)).toBeNull();
  });

  it("records the latest pick next to earlier ones", () => {
    const settings = withSessionSetting({ modeId: "plan" }, { configId: "model", value: "fast" });
    expect(withSessionSetting(settings, { modeId: "code" })).toEqual({
      modeId: "code",
      configOptions: { model: "fast" },
    });
  });

  it("restores only what the session still offers and does not already have", () => {
    const modes = [
      { id: "plan", name: "Plan" },
      { id: "code", name: "Code" },
    ];
    expect(
      getModeToRestore({ modeId: "plan" }, { currentModeId: "code", availableModes: modes }),
    ).toBe("plan");
    expect(
      getModeToRestore({ modeId: "plan" }, { currentModeId: "plan", availableModes: modes }),
    ).toBeNull();
    expect(
      getModeToRestore({ modeId: "gone" }, { currentModeId: "code", availableModes: modes }),
    ).toBeNull();

    expect(
      getConfigOptionsToRestore(
        { configOptions: { model: "fast", thinking: true, removed: "x" } },
        [modelOption, thinkingOption],
      ),
    ).toEqual([
      { configId: "model", value: "fast" },
      { configId: "thinking", value: true },
    ]);
    expect(
      getConfigOptionsToRestore({ configOptions: { model: "retired", thinking: "yes" } }, [
        modelOption,
        thinkingOption,
      ]),
    ).toEqual([]);
  });
});

describe("restoring a chat's session settings", () => {
  const chat = (settings: Chat["sessionSettings"]): Chat => ({
    id: "chat-1",
    title: "Chat",
    messages: [],
    createdAt: new Date(0),
    lastMessageAt: new Date(0),
    agentId: "claude-code",
    acpSessionId: "session-1",
    sessionSettings: settings,
  });

  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(saveChatMetadataToDb).mockClear();
  });

  it("applies the saved picks once the reattached session says what it offers", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    useAIChatStore.setState({
      chats: [chat({ modeId: "plan", configOptions: { model: "fast" } })],
      acpSessions: {},
    });
    const { actions } = useAIChatStore.getState();

    actions.restoreChatSessionSettings("session-1");
    expect(invoke).not.toHaveBeenCalled();

    actions.setSessionModeState("session-1", "code", [
      { id: "plan", name: "Plan" },
      { id: "code", name: "Code" },
    ]);
    actions.setSessionConfigOptions("session-1", [modelOption]);
    actions.restoreChatSessionSettings("session-1");
    actions.restoreChatSessionSettings("session-1");
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    expect(invoke).toHaveBeenCalledWith("set_acp_session_mode", {
      sessionId: "session-1",
      modeId: "plan",
    });
    expect(invoke).toHaveBeenCalledWith("set_acp_session_config_option", {
      args: { sessionId: "session-1", configId: "model", value: "fast" },
    });
  });

  it("remembers a pick and rolls the mode back when the agent refuses it", async () => {
    useAIChatStore.setState({ chats: [chat(null)], acpSessions: {} });
    const { actions } = useAIChatStore.getState();
    actions.setSessionModeState("session-1", "code", [
      { id: "plan", name: "Plan" },
      { id: "code", name: "Code" },
    ]);

    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await actions.changeSessionMode("session-1", "plan");
    expect(useAIChatStore.getState().chats[0].sessionSettings).toEqual({ modeId: "plan" });
    expect(saveChatMetadataToDb).toHaveBeenCalled();

    vi.mocked(invoke).mockRejectedValueOnce(new Error("no"));
    await actions.changeSessionMode("session-1", "code");
    expect(useAIChatStore.getState().acpSessions["session-1"].modeState.currentModeId).toBe("plan");
    expect(useAIChatStore.getState().chats[0].sessionSettings).toEqual({ modeId: "plan" });
  });

  it("saves the chat's follow toggle next to its other picks", () => {
    useAIChatStore.setState({ chats: [chat({ modeId: "plan" })], acpSessions: {} });
    const { actions } = useAIChatStore.getState();

    actions.setChatFollowAgent("chat-1", false);
    expect(useAIChatStore.getState().chats[0].sessionSettings).toEqual({
      modeId: "plan",
      followAgent: false,
    });
    expect(saveChatMetadataToDb).toHaveBeenCalledTimes(1);

    actions.setChatFollowAgent("chat-1", false);
    actions.setChatFollowAgent("unknown", true);
    expect(saveChatMetadataToDb).toHaveBeenCalledTimes(1);
  });
});
