import { describe, expect, test } from "bun:test";
import {
  createHarnessChatScopeId,
  createHarnessSessionKey,
  createScopedChatId,
  DEFAULT_HARNESS_SESSION_KEY,
  filterChatsForScope,
  getDefaultChatTitle,
  getDefaultHarnessBufferTitle,
  getHarnessBufferTitle,
  PANEL_CHAT_SCOPE_ID,
} from "./chat-scope";

describe("chat scope helpers", () => {
  test("creates harness-scoped ids with a prefix", () => {
    expect(createScopedChatId(createHarnessChatScopeId("abc"))).toStartWith("harness:abc:");
  });

  test("filters panel and harness chats independently", () => {
    const scopeId = createHarnessChatScopeId("abc");
    const chats = [
      { id: "123" },
      { id: "456" },
      { id: "harness:abc:789" },
      { id: "harness:def:999" },
    ];

    expect(filterChatsForScope(chats, PANEL_CHAT_SCOPE_ID)).toEqual([{ id: "123" }, { id: "456" }]);
    expect(filterChatsForScope(chats, scopeId)).toEqual([{ id: "harness:abc:789" }]);
  });

  test("uses harness-specific default titles", () => {
    expect(getDefaultChatTitle("panel")).toBe("New Chat");
    expect(getDefaultChatTitle("harness")).toBe("New Session");
  });

  test("creates unique harness session keys", () => {
    const first = createHarnessSessionKey();
    const second = createHarnessSessionKey();

    expect(first).toStartWith("session-");
    expect(second).toStartWith("session-");
    expect(first).not.toBe(second);
  });

  test("resolves harness buffer titles from session and chat titles", () => {
    expect(getDefaultHarnessBufferTitle(DEFAULT_HARNESS_SESSION_KEY)).toBe("Harness");
    expect(getDefaultHarnessBufferTitle("session-123")).toBe("Harness Session");
    expect(getHarnessBufferTitle(DEFAULT_HARNESS_SESSION_KEY, "New Session")).toBe("Harness");
    expect(getHarnessBufferTitle("session-123", "New Session")).toBe("Harness Session");
    expect(getHarnessBufferTitle("session-123", "Fix race in ACP routing")).toBe(
      "Fix race in ACP routing",
    );
  });
});
