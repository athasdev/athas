import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

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

import {
  describeContextUsage,
  formatTokenCount,
  formatUsageCost,
  getContextUsagePercent,
  getContextUsageTone,
} from "@/features/ai/lib/acp-usage";
import { selectChatAcpSession } from "@/features/ai/lib/acp-session-state";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import type { Chat } from "@/features/ai/types/ai-chat.types";

describe("ACP usage formatting", () => {
  it("shortens context window sizes the way agents name them", () => {
    expect(formatTokenCount(850, "en-US")).toBe("850");
    expect(formatTokenCount(1_500, "en-US")).toBe("1.5k");
    expect(formatTokenCount(84_000, "en-US")).toBe("84k");
    expect(formatTokenCount(200_000, "en-US")).toBe("200k");
    expect(formatTokenCount(1_000_000, "en-US")).toBe("1M");
  });

  it("keeps the share of the window between 0 and 100", () => {
    expect(getContextUsagePercent({ used: 84_000, size: 200_000 })).toBe(42);
    expect(getContextUsagePercent({ used: 300, size: 200 })).toBe(100);
    expect(getContextUsagePercent({ used: 10, size: 0 })).toBe(0);
  });

  it("warns as the context window fills up", () => {
    expect(getContextUsageTone({ used: 50, size: 100 })).toBe("accent");
    expect(getContextUsageTone({ used: 80, size: 100 })).toBe("warning");
    expect(getContextUsageTone({ used: 96, size: 100 })).toBe("error");
  });

  it("formats cost in the currency the agent reports", () => {
    expect(formatUsageCost({ amount: 0.18, currency: "USD" }, "en-US")).toBe("$0.18");
    expect(formatUsageCost({ amount: 1.5, currency: "EUR" }, "en-US")).toBe("€1.50");
    expect(formatUsageCost({ amount: 0, currency: "USD" }, "en-US")).toBe("$0.00");
    expect(formatUsageCost({ amount: 0.0042, currency: "USD" }, "en-US")).toBe("$0.0042");
  });

  it("falls back to the raw code when the currency is not ISO 4217", () => {
    expect(formatUsageCost({ amount: 2, currency: "credits" }, "en-US")).toBe("2.00 credits");
  });

  it("describes context use and cost for the tooltip", () => {
    expect(describeContextUsage({ used: 84_000, size: 200_000 }, "en-US")).toBe(
      "42% of 200k context (84k tokens used)",
    );
    expect(
      describeContextUsage(
        { used: 84_000, size: 200_000, cost: { amount: 0.18, currency: "USD" } },
        "en-US",
      ),
    ).toBe("42% of 200k context (84k tokens used) · $0.18 spent");
  });
});

describe("ACP usage state", () => {
  const chat = (id: string, acpSessionId: string) =>
    ({ id, agentId: "gemini", acpSessionId }) as Chat;

  beforeEach(() => {
    useAIChatStore.setState({
      chats: [chat("chat-1", "session-a"), chat("chat-2", "session-b")],
      acpAgents: {},
      acpSessions: {},
    });
  });

  it("keeps only the latest usage of each session", () => {
    const { actions } = useAIChatStore.getState();
    actions.setSessionUsage("session-a", { used: 10, size: 100 });
    actions.setSessionUsage("session-a", {
      used: 20,
      size: 100,
      cost: { amount: 0.01, currency: "USD" },
    });

    const state = useAIChatStore.getState();
    expect(selectChatAcpSession(state, "chat-1").usage).toEqual({
      used: 20,
      size: 100,
      cost: { amount: 0.01, currency: "USD" },
    });
    expect(selectChatAcpSession(state, "chat-2").usage).toBeNull();
  });

  it("forgets usage when the agent process goes away", () => {
    const { actions } = useAIChatStore.getState();
    actions.setSessionUsage("session-a", { used: 10, size: 100 });
    actions.setAcpAgentStatus({
      agentId: "gemini",
      running: false,
      initialized: false,
      sessionIds: ["session-a"],
    });
    expect(selectChatAcpSession(useAIChatStore.getState(), "chat-1").usage).toBeNull();
  });
});
