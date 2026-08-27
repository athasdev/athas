import { describe, expect, it, vi } from "vite-plus/test";
import {
  createAgentNativeNotificationService,
  getAgentNotificationRecord,
  getAgentNativeNotificationContent,
  type AgentNativeNotificationDependencies,
} from "@/features/ai/services/agent-native-notifications";

function createDependencies(
  overrides: Partial<AgentNativeNotificationDependencies> = {},
): AgentNativeNotificationDependencies {
  return {
    isEnabled: vi.fn(() => true),
    isAppFocused: vi.fn(() => Promise.resolve(false)),
    isPermissionGranted: vi.fn(() => Promise.resolve(true)),
    send: vi.fn(),
    now: vi.fn(() => 1_000),
    ...overrides,
  };
}

describe("agent native notifications", () => {
  it("does nothing until the user enables notifications", async () => {
    const dependencies = createDependencies({ isEnabled: () => false });
    const notify = createAgentNativeNotificationService(dependencies);

    await expect(notify({ kind: "complete", dedupeId: "run-1", chatId: "chat-1" })).resolves.toBe(
      "disabled",
    );
    expect(dependencies.isAppFocused).not.toHaveBeenCalled();
    expect(dependencies.send).not.toHaveBeenCalled();
  });

  it("suppresses notifications while an Athas window is focused", async () => {
    const dependencies = createDependencies({ isAppFocused: async () => true });
    const notify = createAgentNativeNotificationService(dependencies);

    await expect(
      notify({ kind: "permission", dedupeId: "request-1", chatId: "chat-1" }),
    ).resolves.toBe("focused");
    expect(dependencies.isPermissionGranted).not.toHaveBeenCalled();
    expect(dependencies.send).not.toHaveBeenCalled();
  });

  it("does not send when OS permission is unavailable", async () => {
    const dependencies = createDependencies({ isPermissionGranted: async () => false });
    const notify = createAgentNativeNotificationService(dependencies);

    await expect(notify({ kind: "error", dedupeId: "run-1", chatId: "chat-1" })).resolves.toBe(
      "permission-denied",
    );
    expect(dependencies.send).not.toHaveBeenCalled();
  });

  it("sends privacy-safe content for background agent events", async () => {
    const dependencies = createDependencies();
    const notify = createAgentNativeNotificationService(dependencies);

    await expect(
      notify({ kind: "permission", dedupeId: "request-1", chatId: "chat-1" }),
    ).resolves.toBe("sent");
    expect(dependencies.send).toHaveBeenCalledWith({
      title: "Agent needs your approval",
      body: "Open Athas to review the request.",
      group: "athas-agent",
      extra: {
        athasRoute: "agent",
        chatId: "chat-1",
      },
    });
    expect(JSON.stringify(getAgentNativeNotificationContent("complete"))).not.toContain(
      "/workspace",
    );
  });

  it("records agent events in the Agent notification category", () => {
    expect(
      getAgentNotificationRecord({
        kind: "permission",
        dedupeId: "request-1",
        chatId: "chat-1",
      }),
    ).toEqual({
      id: "agent:permission:request-1",
      message: "Agent needs your approval",
      description: "Open Athas to review the request.",
      type: "warning",
      category: "agent",
    });
  });

  it("deduplicates the same event within the notification window", async () => {
    const dependencies = createDependencies();
    const notify = createAgentNativeNotificationService(dependencies);

    const request = { kind: "complete" as const, dedupeId: "run-1", chatId: "chat-1" };
    await expect(notify(request)).resolves.toBe("sent");
    await expect(notify(request)).resolves.toBe("duplicate");
    await expect(notify({ kind: "error", dedupeId: "run-1", chatId: "chat-1" })).resolves.toBe(
      "sent",
    );
    expect(dependencies.send).toHaveBeenCalledTimes(2);
  });

  it("allows the same event after the notification window", async () => {
    let now = 1_000;
    const dependencies = createDependencies({ now: () => now });
    const notify = createAgentNativeNotificationService(dependencies);

    const request = { kind: "complete" as const, dedupeId: "run-1", chatId: "chat-1" };
    await notify(request);
    now += 60_000;

    await expect(notify(request)).resolves.toBe("sent");
    expect(dependencies.send).toHaveBeenCalledTimes(2);
  });
});
