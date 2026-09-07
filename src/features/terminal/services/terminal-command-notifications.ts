import { isPermissionGranted, sendNotification } from "@tauri-apps/plugin-notification";
import { isAnyAthasWindowFocused } from "@/features/ai/services/agent-native-notifications";
import { useNotificationsStore } from "@/features/notifications/stores/notifications.store";
import type {
  NotificationType,
  ToastInput,
} from "@/features/notifications/types/notifications.types";
import { showToast } from "@/features/layout/contexts/toast-context";
import type { TerminalCommandSummary } from "../types/terminal.types";

export const TERMINAL_LONG_COMMAND_THRESHOLD_MS = 10_000;

export interface TerminalCommandFinishedEvent {
  terminalId: string;
  terminalName: string;
  command: TerminalCommandSummary;
  isTerminalVisible: boolean;
}

export function formatTerminalCommandDuration(durationMs: number) {
  const totalSeconds = Math.max(1, Math.round(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}

export function describeTerminalCommandCompletion(
  terminalName: string,
  command: TerminalCommandSummary,
): { message: string; description: string; type: NotificationType } {
  const duration = formatTerminalCommandDuration(command.durationMs);
  if (command.status === "failure") {
    return {
      message: `Command failed in ${terminalName}`,
      description: `Exit code ${command.exitCode ?? "unknown"} after ${duration}`,
      type: "error",
    };
  }
  return {
    message: `Command finished in ${terminalName}`,
    description: `Completed in ${duration}`,
    type: "success",
  };
}

interface TerminalCommandNotifierDependencies {
  isEnabled: () => boolean;
  showToast: (value: ToastInput) => string;
  record: (notification: {
    id: string;
    message: string;
    description?: string;
    type: NotificationType;
    category: "athas";
  }) => void;
  isAppFocused: () => Promise<boolean>;
  isPermissionGranted: () => Promise<boolean>;
  sendNative: (options: { title: string; body: string }) => void;
  thresholdMs?: number;
}

export function createTerminalCommandNotifier(dependencies: TerminalCommandNotifierDependencies) {
  const threshold = dependencies.thresholdMs ?? TERMINAL_LONG_COMMAND_THRESHOLD_MS;

  return async function notifyTerminalCommandFinished(
    event: TerminalCommandFinishedEvent,
    activateTerminal: (terminalId: string) => void,
  ): Promise<boolean> {
    if (!dependencies.isEnabled()) return false;
    if (event.command.durationMs < threshold) return false;

    let focused = true;
    try {
      focused = await dependencies.isAppFocused();
    } catch {
      focused = true;
    }
    if (focused && event.isTerminalVisible) return false;

    const notification = describeTerminalCommandCompletion(event.terminalName, event.command);
    const id = `terminal-command:${event.terminalId}:${event.command.finishedAt}`;

    dependencies.record({ id, category: "athas", ...notification });
    dependencies.showToast({
      key: id,
      ...notification,
      action: { label: "Show", onClick: () => activateTerminal(event.terminalId) },
    });

    if (focused) return true;

    try {
      if (!(await dependencies.isPermissionGranted())) return true;
      dependencies.sendNative({ title: notification.message, body: notification.description });
    } catch (error) {
      console.error("Failed to show terminal command notification:", error);
    }
    return true;
  };
}

export const notifyTerminalCommandFinished = createTerminalCommandNotifier({
  isEnabled: () => true,
  showToast: (value) => showToast(value),
  record: (notification) => useNotificationsStore.getState().actions.record(notification),
  isAppFocused: isAnyAthasWindowFocused,
  isPermissionGranted,
  sendNative: ({ title, body }) => sendNotification({ title, body, group: "athas-terminal" }),
});
