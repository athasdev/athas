// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { AcpStreamHandler } from "@/features/ai/services/acp-stream-handler";
import { selectComposerAcpSession } from "@/features/ai/services/acp-session-state";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import type { AcpOptionTarget, SessionConfigOption } from "@/features/ai/types/acp.types";
import type { Chat } from "@/features/ai/types/ai-chat.types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "main" }),
  getAllWebviewWindows: async () => [],
}));
vi.mock("sonner", () => ({ toast: { warning: vi.fn(), error: vi.fn(), success: vi.fn() } }));
vi.mock("@/features/ai/services/ai-chat-history-service", () => ({
  deleteChatFromDb: vi.fn(),
  initChatDatabase: vi.fn(),
  loadAllChatsFromDb: vi.fn(),
  loadChatFromDb: vi.fn(),
  saveChatMetadataToDb: vi.fn().mockResolvedValue(undefined),
  saveChatToDb: vi.fn().mockResolvedValue(undefined),
}));

const AGENT = "gemini-cli";
const draft: AcpOptionTarget = { chatId: null, agentId: AGENT, workspacePath: null };

const modelOption = (currentValue = "flash"): SessionConfigOption => ({
  id: "model",
  name: "Model",
  category: "model",
  kind: {
    type: "select",
    currentValue,
    options: [
      { id: "flash", name: "Flash" },
      { id: "pro", name: "Pro" },
    ],
  },
});

const status = (sessionIds: string[]) => ({
  agentId: AGENT,
  running: true,
  initialized: true,
  workspacePath: null,
  sessionIds,
});

const chat = (acpSessionId: string | null): Chat => ({
  id: "chat-1",
  title: "Chat",
  messages: [],
  createdAt: new Date(0),
  lastMessageAt: new Date(0),
  agentId: AGENT,
  acpSessionId,
});

type OpenArgs = { sessionId: string | null; prepare: boolean | null };
const opens = () =>
  vi
    .mocked(invoke)
    .mock.calls.filter(([command]) => command === "open_acp_session")
    .map(([, args]) => {
      const { sessionId, prepare } = args as OpenArgs;
      return { sessionId, prepare };
    });

/** Answers session opens like the bridge: a new session reports its options before it returns. */
function agentOpensSessions(newSessionId = "prepared-1") {
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command !== "open_acp_session") return undefined;
    const sessionId = (args as OpenArgs).sessionId ?? newSessionId;
    useAIChatStore.getState().actions.setSessionConfigOptions(sessionId, [modelOption()]);
    return { sessionId, status: status([sessionId]) };
  });
}

const composer = (target: AcpOptionTarget = draft) =>
  selectComposerAcpSession(useAIChatStore.getState(), target);

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  vi.mocked(toast.warning).mockClear();
  useAIChatStore.setState({
    chats: [],
    acpAgents: {},
    acpSessions: {},
    acpPrepares: {},
    acpPendingPicks: {},
    acpOptionCache: {},
  });
});

describe("preparing an ACP agent's session before the first prompt", () => {
  it("shows the agent's models as soon as it is picked, and the first prompt reuses the session", async () => {
    agentOpensSessions();

    const preparing = AcpStreamHandler.prepare(AGENT, null);
    expect(composer().isLoading).toBe(true);
    await preparing;

    expect(opens()).toEqual([{ sessionId: null, prepare: true }]);
    expect(composer()).toMatchObject({ sessionId: "prepared-1", isLoading: false });
    expect(composer().session.configOptions[0].kind.currentValue).toBe("flash");
    expect(useAIChatStore.getState().acpOptionCache[AGENT]?.configOptions).toHaveLength(1);

    // Picking the agent again while its session is open does not open another one.
    await AcpStreamHandler.prepare(AGENT, null);
    expect(opens()).toHaveLength(1);

    useAIChatStore.setState({ chats: [chat(null)] });
    const handler = new AcpStreamHandler(
      AGENT,
      { onChunk: vi.fn(), onComplete: vi.fn(), onError: vi.fn() },
      "chat-1",
    ) as unknown as { ensureSession: () => Promise<void> };
    await handler.ensureSession();

    expect(opens()).toEqual([
      { sessionId: null, prepare: true },
      { sessionId: "prepared-1", prepare: null },
    ]);
    expect(useAIChatStore.getState().chats[0].acpSessionId).toBe("prepared-1");
    expect(useAIChatStore.getState().acpPrepares).toEqual({});
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("stays quiet when the agent needs a sign-in, and leaves it to the first prompt", async () => {
    useAIChatStore.setState({
      acpOptionCache: {
        [AGENT]: {
          slashCommands: [],
          modeState: { currentModeId: null, availableModes: [] },
          configOptions: [modelOption("pro")],
          usage: null,
        },
      },
    });
    vi.mocked(invoke).mockRejectedValue(
      new Error("Authentication required: choose how to sign in to the agent"),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await AcpStreamHandler.prepare(AGENT, null);
    await AcpStreamHandler.prepare(AGENT, null);

    expect(opens()).toEqual([{ sessionId: null, prepare: true }]);
    expect(toast.warning).not.toHaveBeenCalled();
    expect(composer()).toMatchObject({ sessionId: null, isLoading: false });
    expect(composer().session.configOptions[0].kind.currentValue).toBe("pro");
  });

  it("applies a model picked from the last known list once the session opens", async () => {
    useAIChatStore.setState({
      acpOptionCache: {
        [AGENT]: {
          slashCommands: [],
          modeState: { currentModeId: null, availableModes: [] },
          configOptions: [modelOption()],
          usage: null,
        },
      },
    });
    let open: () => void = () => {};
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command !== "open_acp_session") return undefined;
      await new Promise<void>((resolve) => {
        open = resolve;
      });
      useAIChatStore.getState().actions.setSessionConfigOptions("prepared-1", [modelOption()]);
      return { sessionId: "prepared-1", status: status(["prepared-1"]) };
    });

    const preparing = AcpStreamHandler.prepare(AGENT, null);
    useAIChatStore.getState().actions.changeAcpOption(draft, { configId: "model", value: "pro" });
    expect(composer().session.configOptions[0].kind.currentValue).toBe("pro");
    await vi.waitFor(() => expect(opens()).toHaveLength(1));
    open();
    await preparing;

    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("set_acp_session_config_option", {
        args: { sessionId: "prepared-1", configId: "model", value: "pro" },
      }),
    );
    expect(useAIChatStore.getState().acpPendingPicks).toEqual({});
  });

  it("reattaches a restored chat's own session without changing it", async () => {
    agentOpensSessions();
    useAIChatStore.setState({ chats: [chat("earlier-1")] });
    const target = { chatId: "chat-1", agentId: AGENT, workspacePath: null };

    await AcpStreamHandler.prepare(AGENT, "chat-1");

    expect(opens()).toEqual([{ sessionId: "earlier-1", prepare: true }]);
    expect(useAIChatStore.getState().chats[0].acpSessionId).toBe("earlier-1");
    expect(composer(target)).toMatchObject({ sessionId: "earlier-1", isLoading: false });
  });

  it("keeps the last known options across restarts", () => {
    const { partialize } = useAIChatStore.persist.getOptions();
    useAIChatStore.setState({
      acpOptionCache: {
        [AGENT]: {
          slashCommands: [],
          modeState: { currentModeId: null, availableModes: [] },
          configOptions: [modelOption()],
          usage: null,
        },
      },
    });

    expect(partialize?.(useAIChatStore.getState())).toMatchObject({
      acpOptionCache: { [AGENT]: { configOptions: [modelOption()] } },
    });
  });
});
