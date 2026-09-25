import { describe, expect, it, vi } from "vite-plus/test";
import {
  createAgentNativeNotificationService,
  decideAgentNotification,
  getAgentNotificationSound,
  getAgentNotificationRecord,
  getAgentNativeNotificationContent,
  type AgentNativeNotificationDependencies,
} from "@/features/ai/services/agent-native-notifications";

function createDependencies(
  overrides: Partial<AgentNativeNotificationDependencies> = {},
): AgentNativeNotificationDependencies {
  return {
    getSettings: vi.fn(() => ({ enabled: true, finished: true, sound: false })),
    isWindowFocused: vi.fn(() => Promise.resolve(false)),
    isAppFocused: vi.fn(() => Promise.resolve(false)),
    isChatVisible: vi.fn(() => false),
    isPermissionGranted: vi.fn(() => Promise.resolve(true)),
    send: vi.fn(),
    requestAttention: vi.fn(() => Promise.resolve()),
    now: vi.fn(() => 1_000),
    platform: "macos",
    ...overrides,
  };
}

describe("agent native notifications", () => {
  it("does nothing until the user enables notifications", async () => {
    const dependencies = createDependencies({
      getSettings: () => ({ enabled: false, finished: true, sound: false }),
    });
    const notify = createAgentNativeNotificationService(dependencies);

    await expect(notify({ kind: "complete", dedupeId: "run-1", chatId: "chat-1" })).resolves.toBe(
      "disabled",
    );
    expect(dependencies.isWindowFocused).not.toHaveBeenCalled();
    expect(dependencies.send).not.toHaveBeenCalled();
  });

  it("suppresses notifications for the chat on screen in a focused window", async () => {
    const dependencies = createDependencies({
      isWindowFocused: async () => true,
      isAppFocused: async () => true,
      isChatVisible: () => true,
    });
    const notify = createAgentNativeNotificationService(dependencies);

    await expect(
      notify({ kind: "permission", dedupeId: "request-1", chatId: "chat-1" }),
    ).resolves.toBe("focused");
    expect(dependencies.isPermissionGranted).not.toHaveBeenCalled();
    expect(dependencies.requestAttention).not.toHaveBeenCalled();
    expect(dependencies.send).not.toHaveBeenCalled();
  });

  it("notifies about a chat the focused window is not showing", async () => {
    const dependencies = createDependencies({
      isWindowFocused: async () => true,
      isAppFocused: async () => true,
      isChatVisible: (chatId) => chatId === "chat-2",
    });
    const notify = createAgentNativeNotificationService(dependencies);

    await expect(
      notify({ kind: "question", dedupeId: "request-1", chatId: "chat-1" }),
    ).resolves.toBe("sent");
    // The app is in front, so there is nothing to bounce.
    expect(dependencies.requestAttention).not.toHaveBeenCalled();
  });

  it("asks for dock attention only for prompts that block the agent", async () => {
    const dependencies = createDependencies();
    const notify = createAgentNativeNotificationService(dependencies);

    await notify({ kind: "complete", dedupeId: "run-1", chatId: "chat-1" });
    expect(dependencies.requestAttention).not.toHaveBeenCalled();
    await notify({ kind: "auth", dedupeId: "agent-1", chatId: "chat-1" });
    expect(dependencies.requestAttention).toHaveBeenCalledTimes(1);
  });

  it("still asks for attention when OS notifications are not allowed", async () => {
    const dependencies = createDependencies({ isPermissionGranted: async () => false });
    const notify = createAgentNativeNotificationService(dependencies);

    await expect(
      notify({ kind: "permission", dedupeId: "request-1", chatId: "chat-1" }),
    ).resolves.toBe("permission-denied");
    expect(dependencies.requestAttention).toHaveBeenCalledTimes(1);
  });

  it("plays the system sound only when the setting is on", async () => {
    const dependencies = createDependencies({
      getSettings: () => ({ enabled: true, finished: true, sound: true }),
    });
    const notify = createAgentNativeNotificationService(dependencies);

    await notify({ kind: "complete", dedupeId: "run-1", chatId: "chat-1" });
    expect(dependencies.send).toHaveBeenCalledWith(
      expect.objectContaining({ sound: "NSUserNotificationDefaultSoundName" }),
    );
    expect(getAgentNotificationSound("windows")).toBe("Default");
    expect(getAgentNotificationSound("linux")).toBe("message-new-instant");
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

describe("decideAgentNotification", () => {
  const settings = { enabled: true, finished: true, sound: false };
  const away = { windowFocused: false, chatVisible: false };

  it("notifies for every kind while the user is away", () => {
    for (const kind of ["complete", "error", "permission", "question", "auth"] as const) {
      expect(decideAgentNotification(kind, settings, away)).toBe("notify");
    }
  });

  it("stays quiet for the chat on screen in a focused window", () => {
    expect(
      decideAgentNotification("permission", settings, { windowFocused: true, chatVisible: true }),
    ).toBe("focused");
  });

  it("notifies when either the window is unfocused or the chat is hidden", () => {
    expect(
      decideAgentNotification("question", settings, { windowFocused: false, chatVisible: true }),
    ).toBe("notify");
    expect(
      decideAgentNotification("question", settings, { windowFocused: true, chatVisible: false }),
    ).toBe("notify");
  });

  it("drops finished and failed turns when that group is off, but keeps prompts", () => {
    const promptsOnly = { ...settings, finished: false };
    expect(decideAgentNotification("complete", promptsOnly, away)).toBe("disabled");
    expect(decideAgentNotification("error", promptsOnly, away)).toBe("disabled");
    expect(decideAgentNotification("auth", promptsOnly, away)).toBe("notify");
  });

  it("sends nothing when agent notifications are off", () => {
    expect(decideAgentNotification("permission", { ...settings, enabled: false }, away)).toBe(
      "disabled",
    );
  });
});
