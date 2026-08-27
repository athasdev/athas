import { getAllWindows } from "@tauri-apps/api/window";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { useNotificationsStore } from "@/features/notifications/stores/notifications.store";
import { useSettingsStore } from "@/features/settings/stores/settings.store";

export type AgentNativeNotificationKind = "complete" | "error" | "permission";
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
  extra?: Record<string, unknown>;
}

export interface AgentNativeNotificationDependencies {
  isEnabled: () => boolean;
  isAppFocused: () => Promise<boolean>;
  isPermissionGranted: () => Promise<boolean>;
  send: (options: NativeNotificationOptions) => void;
  now: () => number;
}

const DEDUPE_WINDOW_MS = 60_000;

export function getAgentNativeNotificationContent(
  kind: AgentNativeNotificationKind,
): NativeNotificationOptions {
  switch (kind) {
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
        : request.kind === "permission"
          ? ("warning" as const)
          : ("success" as const),
    category: "agent" as const,
  };
}

export function createAgentNativeNotificationService(
  dependencies: AgentNativeNotificationDependencies,
) {
  const recentNotifications = new Map<string, number>();
  const pendingNotifications = new Set<string>();

  return async function notifyAgent(
    request: AgentNativeNotificationRequest,
  ): Promise<AgentNativeNotificationResult> {
    if (!dependencies.isEnabled()) return "disabled";

    const key = `${request.kind}:${request.dedupeId}`;
    if (pendingNotifications.has(key)) return "duplicate";
    pendingNotifications.add(key);

    try {
      if (await dependencies.isAppFocused()) return "focused";
      if (!(await dependencies.isPermissionGranted())) return "permission-denied";

      const now = dependencies.now();
      for (const [notificationKey, timestamp] of recentNotifications) {
        if (now - timestamp >= DEDUPE_WINDOW_MS) recentNotifications.delete(notificationKey);
      }

      const previousTimestamp = recentNotifications.get(key);
      if (previousTimestamp !== undefined && now - previousTimestamp < DEDUPE_WINDOW_MS) {
        return "duplicate";
      }

      dependencies.send({
        ...getAgentNativeNotificationContent(request.kind),
        group: "athas-agent",
        extra: {
          athasRoute: "agent",
          chatId: request.chatId,
        },
      });
      recentNotifications.set(key, now);
      return "sent";
    } catch (error) {
      console.error("Failed to show agent notification:", error);
      return "failed";
    } finally {
      pendingNotifications.delete(key);
    }
  };
}

async function isAnyAthasWindowFocused(): Promise<boolean> {
  try {
    const windows = await getAllWindows();
    const focusStates = await Promise.all(windows.map((window) => window.isFocused()));
    return focusStates.some(Boolean);
  } catch {
    if (typeof document === "undefined") return true;
    return document.visibilityState === "visible" && document.hasFocus();
  }
}

const notifyAgent = createAgentNativeNotificationService({
  isEnabled: () => useSettingsStore.getState().settings.aiAgentNotifications,
  isAppFocused: isAnyAthasWindowFocused,
  isPermissionGranted,
  send: sendNotification,
  now: Date.now,
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
