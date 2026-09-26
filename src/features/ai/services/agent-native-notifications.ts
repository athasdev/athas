import { getAllWindows, getCurrentWindow, UserAttentionType } from "@tauri-apps/api/window";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { useNotificationsStore } from "@/features/notifications/stores/notifications.store";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { isAgentChatVisible } from "@/features/ai/lib/visible-agent-chats";
import { currentPlatform } from "@/utils/platform";

export type AgentNativeNotificationKind = "complete" | "error" | "permission" | "question" | "auth";
export type AgentNativeNotificationResult =
  | "sent"
  | "disabled"
  | "focused"
  | "permission-denied"
  | "duplicate"
  | "failed";
export type AgentNativeNotificationPermissionResult = "granted" | "denied" | "unavailable";

export interface AgentNativeNotificationRequest {
  kind: AgentNativeNotificationKind;
  dedupeId: string;
  chatId: string;
}

export interface NativeNotificationOptions {
  title: string;
  body: string;
  group?: string;
  sound?: string;
  extra?: Record<string, unknown>;
}

export interface AgentNotificationSettings {
  /** Master switch for agent notifications. */
  enabled: boolean;
  /** Also notify when a turn finishes or fails, not only when the agent waits on the user. */
  finished: boolean;
  /** Play the system notification sound. */
  sound: boolean;
}

export interface AgentNotificationView {
  /** The window that runs the chat has focus. */
  windowFocused: boolean;
  /** The chat is on screen in that window. */
  chatVisible: boolean;
}

export type AgentNotificationDecision = "notify" | "disabled" | "focused";

export interface AgentNativeNotificationDependencies {
  getSettings: () => AgentNotificationSettings;
  /** Whether the window running the chat has focus. */
  isWindowFocused: () => Promise<boolean>;
  /** Whether any Athas window has focus. */
  isAppFocused: () => Promise<boolean>;
  isChatVisible: (chatId: string) => boolean;
  isPermissionGranted: () => Promise<boolean>;
  send: (options: NativeNotificationOptions) => void;
  /** Bounces the dock icon or flashes the taskbar button. */
  requestAttention: () => Promise<void>;
  now: () => number;
  platform: string;
}

const DEDUPE_WINDOW_MS = 60_000;

/** Kinds where the agent is stuck until the user answers. */
export function isBlockingAgentNotification(kind: AgentNativeNotificationKind): boolean {
  return kind === "permission" || kind === "question" || kind === "auth";
}

/**
 * Whether an agent event should reach the user through the OS. Nothing is sent for a chat the
 * user is looking at in a focused window; everything else follows the settings.
 */
export function decideAgentNotification(
  kind: AgentNativeNotificationKind,
  settings: AgentNotificationSettings,
  view: AgentNotificationView,
): AgentNotificationDecision {
  if (!settings.enabled) return "disabled";
  if (!isBlockingAgentNotification(kind) && !settings.finished) return "disabled";
  if (view.windowFocused && view.chatVisible) return "focused";
  return "notify";
}

/** The platform's default notification sound, as the notification plugin names it. */
export function getAgentNotificationSound(platform: string): string {
  switch (platform) {
    case "macos":
      return "NSUserNotificationDefaultSoundName";
    case "windows":
      return "Default";
    default:
      return "message-new-instant";
  }
}

export function getAgentNativeNotificationContent(
  kind: AgentNativeNotificationKind,
): NativeNotificationOptions {
  switch (kind) {
    case "auth":
      return {
        title: "Agent needs you to sign in",
        body: "Open Athas to sign in.",
      };
    case "question":
      return {
        title: "Agent has a question",
        body: "Open Athas to answer it.",
      };
    case "permission":
      return {
        title: "Agent needs your approval",
        body: "Open Athas to review the request.",
      };
    case "error":
      return {
        title: "Agent stopped",
        body: "Open Athas to review the error.",
      };
    case "complete":
      return {
        title: "Agent finished",
        body: "Open Athas to review the result.",
      };
  }
}

export function getAgentNotificationRecord(request: AgentNativeNotificationRequest) {
  const content = getAgentNativeNotificationContent(request.kind);
  return {
    id: `agent:${request.kind}:${request.dedupeId}`,
    message: content.title,
    description: content.body,
    type:
      request.kind === "error"
        ? ("error" as const)
        : isBlockingAgentNotification(request.kind)
          ? ("warning" as const)
          : ("success" as const),
    category: "agent" as const,
  };
}

const NOT_SEEN: AgentNotificationView = { windowFocused: false, chatVisible: false };

export function createAgentNativeNotificationService(
  dependencies: AgentNativeNotificationDependencies,
) {
  const recentNotifications = new Map<string, number>();
  const pendingNotifications = new Set<string>();

  return async function notifyAgent(
    request: AgentNativeNotificationRequest,
  ): Promise<AgentNativeNotificationResult> {
    const settings = dependencies.getSettings();
    if (decideAgentNotification(request.kind, settings, NOT_SEEN) === "disabled") {
      return "disabled";
    }

    const key = `${request.kind}:${request.dedupeId}`;
    if (pendingNotifications.has(key)) return "duplicate";
    pendingNotifications.add(key);

    try {
      const view = {
        windowFocused: await dependencies.isWindowFocused(),
        chatVisible: dependencies.isChatVisible(request.chatId),
      };
      if (decideAgentNotification(request.kind, settings, view) === "focused") return "focused";

      const now = dependencies.now();
      for (const [notificationKey, timestamp] of recentNotifications) {
        if (now - timestamp >= DEDUPE_WINDOW_MS) recentNotifications.delete(notificationKey);
      }

      const previousTimestamp = recentNotifications.get(key);
      if (previousTimestamp !== undefined && now - previousTimestamp < DEDUPE_WINDOW_MS) {
        return "duplicate";
      }
      recentNotifications.set(key, now);

      if (isBlockingAgentNotification(request.kind) && !(await dependencies.isAppFocused())) {
        await dependencies.requestAttention().catch(() => undefined);
      }
      if (!(await dependencies.isPermissionGranted())) return "permission-denied";

      dependencies.send({
        ...getAgentNativeNotificationContent(request.kind),
        group: "athas-agent",
        ...(settings.sound ? { sound: getAgentNotificationSound(dependencies.platform) } : {}),
        extra: {
          athasRoute: "agent",
          chatId: request.chatId,
        },
      });
      return "sent";
    } catch (error) {
      console.error("Failed to show agent notification:", error);
      return "failed";
    } finally {
      pendingNotifications.delete(key);
    }
  };
}

export async function isAnyAthasWindowFocused(): Promise<boolean> {
  try {
    const windows = await getAllWindows();
    const focusStates = await Promise.all(windows.map((window) => window.isFocused()));
    return focusStates.some(Boolean);
  } catch {
    if (typeof document === "undefined") return true;
    return document.visibilityState === "visible" && document.hasFocus();
  }
}

async function isThisWindowFocused(): Promise<boolean> {
  if (typeof document !== "undefined" && document.visibilityState !== "visible") return false;
  try {
    return await getCurrentWindow().isFocused();
  } catch {
    return typeof document === "undefined" || document.hasFocus();
  }
}

const notifyAgent = createAgentNativeNotificationService({
  getSettings: () => {
    const { settings } = useSettingsStore.getState();
    return {
      enabled: settings.aiAgentNotifications,
      finished: settings.aiAgentFinishNotifications,
      sound: settings.aiAgentNotificationSound,
    };
  },
  isWindowFocused: isThisWindowFocused,
  isAppFocused: isAnyAthasWindowFocused,
  isChatVisible: isAgentChatVisible,
  isPermissionGranted,
  send: sendNotification,
  requestAttention: () => getCurrentWindow().requestUserAttention(UserAttentionType.Informational),
  now: Date.now,
  platform: currentPlatform,
});

export async function sendAgentNativeNotification(
  request: AgentNativeNotificationRequest,
): Promise<AgentNativeNotificationResult> {
  useNotificationsStore.getState().actions.record(getAgentNotificationRecord(request));
  return notifyAgent(request);
}

export async function requestAgentNativeNotificationPermission(): Promise<AgentNativeNotificationPermissionResult> {
  try {
    if (await isPermissionGranted()) return "granted";
    return (await requestPermission()) === "granted" ? "granted" : "denied";
  } catch (error) {
    console.error("Failed to request native notification permission:", error);
    return "unavailable";
  }
}
