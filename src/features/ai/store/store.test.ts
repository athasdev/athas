import { describe, expect, test } from "bun:test";
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
