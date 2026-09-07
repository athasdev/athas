import { isPermissionGranted, sendNotification } from "@tauri-apps/plugin-notification";
import { isAnyAthasWindowFocused } from "@/features/ai/services/agent-native-notifications";
import { useNotificationsStore } from "@/features/notifications/stores/notifications.store";
import type {
  NotificationType,
  ToastInput,
} from "@/features/notifications/types/notifications.types";
import { showToast } from "@/features/layout/contexts/toast-context";
import type { WorkflowRunListItem } from "../types/github.types";
import type { WorkflowRunChange } from "../utils/github-workflow-run-changes";
import {
  formatWorkflowDuration,
  getWorkflowRunLabel,
  getWorkflowRunState,
  getWorkflowRunTiming,
  getWorkflowRunTitle,
} from "../utils/github-workflow-status";

const MAX_INDIVIDUAL_NOTIFICATIONS = 3;

export interface WorkflowRunNotification {
  id: string;
  message: string;
  description: string;
  type: NotificationType;
  run: WorkflowRunListItem;
}

export function describeWorkflowRunChange(change: WorkflowRunChange): WorkflowRunNotification {
  const { run } = change;
  const state = getWorkflowRunState(run.status, run.conclusion);
  const workflow = run.workflowName || run.name || "Workflow";
  const title = getWorkflowRunTitle(run);
  const context = [run.headBranch, getWorkflowRunLabel(run)].filter(Boolean).join(" · ");
  const attempt = run.runAttempt && run.runAttempt > 1 ? ` (attempt ${run.runAttempt})` : "";
  const id = `github-action:${run.databaseId}:${run.runAttempt ?? 1}:${change.type}`;

  if (change.type === "started") {
    return {
      id,
      message: `${workflow} started${attempt}`,
      description: [title, context].filter(Boolean).join(" · "),
      type: "info",
      run,
    };
  }

  const duration = formatWorkflowDuration(getWorkflowRunTiming(run).durationMs);
  const outcome =
    state.phase === "success"
      ? "passed"
      : state.phase === "cancelled"
        ? "was cancelled"
        : state.isFailed
          ? "failed"
          : state.label.toLowerCase();

  return {
    id,
    message: `${workflow} ${outcome}${attempt}`,
    description: [title, context, duration ? `in ${duration}` : null].filter(Boolean).join(" · "),
    type:
      state.phase === "success"
        ? "success"
        : state.isFailed
          ? "error"
          : state.phase === "cancelled"
            ? "warning"
            : "info",
    run,
  };
}

interface WorkflowNotificationDependencies {
  isEnabled: () => boolean;
  showToast: (value: ToastInput) => string;
  record: (notification: {
    id: string;
    message: string;
    description?: string;
    type: NotificationType;
    category: "github";
  }) => void;
  isAppFocused: () => Promise<boolean>;
  isPermissionGranted: () => Promise<boolean>;
  sendNative: (options: { title: string; body: string }) => void;
}

export function createWorkflowRunNotifier(dependencies: WorkflowNotificationDependencies) {
  return async function notifyWorkflowRunChanges(
    changes: WorkflowRunChange[],
    openRun: (run: WorkflowRunListItem) => void,
  ) {
    if (changes.length === 0 || !dependencies.isEnabled()) return;

    const notifications = changes.map(describeWorkflowRunChange);
    const shown = notifications.slice(0, MAX_INDIVIDUAL_NOTIFICATIONS);
    const overflow = notifications.length - shown.length;

    for (const notification of notifications) {
      dependencies.record({
        id: notification.id,
        message: notification.message,
        description: notification.description,
        type: notification.type,
        category: "github",
      });
    }

    for (const notification of shown) {
      dependencies.showToast({
        key: notification.id,
        message: notification.message,
        description: notification.description,
        type: notification.type,
        action: { label: "Open", onClick: () => openRun(notification.run) },
      });
    }

    if (overflow > 0) {
      dependencies.showToast({
        key: `github-action:overflow:${Date.now()}`,
        message: `${overflow} more workflow run${overflow === 1 ? "" : "s"} changed`,
        type: "info",
      });
    }

    try {
      if (await dependencies.isAppFocused()) return;
      if (!(await dependencies.isPermissionGranted())) return;

      const failures = notifications.filter((notification) => notification.type === "error");
      const headline = failures[0] ?? shown[0];
      if (!headline) return;

      dependencies.sendNative({
        title: headline.message,
        body:
          notifications.length > 1
            ? `${headline.description} · ${notifications.length - 1} more`
            : headline.description,
      });
    } catch (error) {
      console.error("Failed to show workflow run notification:", error);
    }
  };
}

export const notifyWorkflowRunChanges = createWorkflowRunNotifier({
  isEnabled: () => true,
  showToast: (value) => showToast(value),
  record: (notification) => useNotificationsStore.getState().actions.record(notification),
  isAppFocused: isAnyAthasWindowFocused,
  isPermissionGranted,
  sendNative: ({ title, body }) => sendNotification({ title, body, group: "athas-github" }),
});
