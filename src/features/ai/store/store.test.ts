import { beforeEach, describe, expect, mock, test } from "bun:test";
import { normalizePersistedAIChatState } from "./persist";
import { createDefaultChatScopeState, getDefaultAgentIdForScope } from "./scope-defaults";

describe("normalizePersistedAIChatState", () => {
  test("unwraps Zustand persist payloads stored as { state, version }", () => {
    const persisted = {
      state: {
        outputStyle: "compact",
        chatScopes: {
          "harness:harness": {
            currentChatId: null,
            selectedAgentId: "pi",
            mode: "chat",
            sessionModeState: {
              currentModeId: null,
              availableModes: [],
            },
          },
        },
      },
      version: 3,
    };

    expect(normalizePersistedAIChatState(persisted)).toMatchObject(persisted.state);
  });

  test("keeps already-unwrapped persisted AI chat state unchanged", () => {
    const persisted = {
      outputStyle: "default",
      chatScopes: {
        panel: {
          currentChatId: null,
          selectedAgentId: "custom",
          mode: "chat",
          sessionModeState: {
            currentModeId: null,
            availableModes: [],
          },
        },
      },
    };

    expect(normalizePersistedAIChatState(persisted)).toMatchObject(persisted);
  });
});

describe("scope defaults", () => {
  test("defaults the panel scope to the custom API agent", () => {
    expect(getDefaultAgentIdForScope("panel")).toBe("custom");
    expect(createDefaultChatScopeState("panel")).toMatchObject({
      currentChatId: null,
      selectedAgentId: "custom",
      mode: "chat",
    });
  });

  test("defaults Harness scopes to Pi", () => {
    expect(getDefaultAgentIdForScope("harness:harness")).toBe("pi");
    expect(createDefaultChatScopeState("harness:harness")).toMatchObject({
      currentChatId: null,
      selectedAgentId: "pi",
      mode: "chat",
    });
  });
});

describe("loadChatsFromDatabase", () => {
  beforeEach(() => {
    globalThis.localStorage?.clear();
  });

  test("hydrates the current restored Harness chat after loading metadata", async () => {
    Object.assign(globalThis, {
      window: {
        __TAURI_OS_PLUGIN_INTERNALS__: {
          platform: "linux",
          arch: "x86_64",
          eol: "\n",
          version: "test",
          family: "unix",
          os_type: "linux",
          exe_extension: "",
        },
      },
    });

    const restoredChatId = "harness:harness:1774545585555";
    const restoredScopeId = "harness:harness" as const;
    const metadataChat = {
      id: restoredChatId,
      title: "Reply with exactly WATCHED and nothing else.",
      messages: [],
      createdAt: new Date("2026-03-27T10:00:00.000Z"),
      lastMessageAt: new Date("2026-03-27T10:01:00.000Z"),
      agentId: "pi" as const,
      parentChatId: null,
      rootChatId: restoredChatId,
      branchPointMessageId: null,
      lineageDepth: 0,
      sessionName: null,
      acpState: null,
      acpActivity: null,
    };
    const fullChat = {
      ...metadataChat,
      messages: [
        {
          id: "message-user",
          lineageMessageId: "message-user",
          content: "Reply with exactly WATCHED and nothing else.",
          role: "user" as const,
          timestamp: new Date("2026-03-27T10:00:00.000Z"),
        },
        {
          id: "message-assistant",
          lineageMessageId: "message-assistant",
          content: "WATCHED",
          role: "assistant" as const,
          timestamp: new Date("2026-03-27T10:01:00.000Z"),
        },
      ],
    };

    const loadAllChatsFromDb = mock(async () => [metadataChat]);
    const loadChatFromDb = mock(async (chatId: string) => {
      expect(chatId).toBe(restoredChatId);
      return fullChat;
    });

    mock.module("@/utils/chat-history-db", () => ({
      initChatDatabase: async () => {},
      loadAllChatsFromDb,
      loadChatFromDb,
      saveChatToDb: async () => {},
      deleteChatFromDb: async () => {},
    }));
    mock.module("@/utils/ai-chat", () => ({
      getProviderApiToken: async () => null,
      isAcpAgent: (agentId: string) => agentId !== "custom",
      removeProviderApiToken: async () => {},
      storeProviderApiToken: async () => {},
      validateProviderApiKey: async () => true,
    }));

    const { useAIChatStore } = await import("./store");

    useAIChatStore.setState({
      chats: [],
      chatScopes: {
        panel: createDefaultChatScopeState("panel"),
        [restoredScopeId]: {
          ...createDefaultChatScopeState(restoredScopeId),
          currentChatId: restoredChatId,
          selectedAgentId: "pi",
        },
      },
    });

    await useAIChatStore.getState().loadChatsFromDatabase();

    expect(loadAllChatsFromDb).toHaveBeenCalledTimes(1);
    expect(loadChatFromDb).toHaveBeenCalledTimes(1);
    expect(useAIChatStore.getState().getCurrentChat(restoredScopeId)).toMatchObject({
      id: restoredChatId,
      title: "Reply with exactly WATCHED and nothing else.",
    });
    expect(useAIChatStore.getState().getCurrentMessages(restoredScopeId)).toEqual(
      fullChat.messages,
    );
  });
});

describe("createSeededChat", () => {
  beforeEach(() => {
    globalThis.localStorage?.clear();
  });

  test("persists seeded Pi chats with their hydrated transcript", async () => {
    const saveChatToDb = mock(async () => {});

    mock.module("@/utils/chat-history-db", () => ({
      initChatDatabase: async () => {},
      loadAllChatsFromDb: async () => [],
      loadChatFromDb: async () => null,
      saveChatToDb,
      deleteChatFromDb: async () => {},
    }));
    mock.module("@/utils/ai-chat", () => ({
      getProviderApiToken: async () => null,
      isAcpAgent: (agentId: string) => agentId !== "custom",
      removeProviderApiToken: async () => {},
      storeProviderApiToken: async () => {},
      validateProviderApiKey: async () => true,
    }));

    const { useAIChatStore } = await import("./store");
    const scopeId = "harness:seeded" as const;
    const timestamp = new Date("2026-03-28T00:30:00.000Z");

    useAIChatStore.setState({
      chats: [],
      chatScopes: {
        panel: createDefaultChatScopeState("panel"),
        [scopeId]: createDefaultChatScopeState(scopeId),
      },
    });

    const chatId = useAIChatStore.getState().createSeededChat(
      "pi",
      {
        title: "Seeded Pi Session",
        messages: [
          {
            id: "message-user",
            lineageMessageId: "message-user",
            content: "Reply with exactly READY and nothing else.",
            role: "user",
            timestamp,
            kind: "default",
          },
          {
            id: "message-assistant",
            lineageMessageId: "message-assistant",
            content: "READY",
            role: "assistant",
            timestamp: new Date("2026-03-28T00:31:00.000Z"),
            kind: "default",
          },
        ],
        acpState: null,
        acpActivity: null,
      },
      scopeId,
    );

    expect(useAIChatStore.getState().getCurrentChat(scopeId)).toMatchObject({
      id: chatId,
      title: "Seeded Pi Session",
      agentId: "pi",
    });
    expect(useAIChatStore.getState().getCurrentMessages(scopeId)).toHaveLength(2);
    expect(saveChatToDb.mock.calls.length).toBeGreaterThan(0);
    const seededSave = ((saveChatToDb.mock.calls as unknown as Array<[unknown]>).slice(-1)[0] ?? [
      undefined,
    ])[0];
    expect(seededSave).toMatchObject({
      id: chatId,
      title: "Seeded Pi Session",
      messages: [{ content: "Reply with exactly READY and nothing else." }, { content: "READY" }],
    });
  });
});
