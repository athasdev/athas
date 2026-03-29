import {
  appendChatAcpEvent,
  type ChatAcpEventInput,
  updateToolCompletionAcpEvent,
} from "@/features/ai/lib/acp-event-timeline";
import type { AcpAgentStatus, AcpPlanEntry } from "@/features/ai/types/acp";
import type { ChatAcpActivity } from "@/features/ai/types/ai-chat";
import type {
  ChatAcpEvent,
  ChatAcpPermissionRequest,
  ChatAcpToolEventData,
} from "@/features/ai/types/chat-ui";

const MAX_PERMISSION_HISTORY = 20;

const cloneToolEventData = (tool?: ChatAcpToolEventData): ChatAcpToolEventData | undefined =>
  tool
    ? {
        ...tool,
        locations: tool.locations?.map((location) => ({ ...location })),
      }
    : undefined;

const cloneAcpEvent = (event: ChatAcpEvent): ChatAcpEvent => ({
  ...event,
  tool: cloneToolEventData(event.tool),
  timestamp: new Date(event.timestamp),
});

const clonePlanEntry = (entry: AcpPlanEntry): AcpPlanEntry => ({
  ...entry,
});

const clonePermissionRequest = (
  permission: ChatAcpPermissionRequest,
): ChatAcpPermissionRequest => ({
  ...permission,
  options: permission.options ? [...permission.options] : permission.options,
  timestamp: new Date(permission.timestamp),
  resolvedAt: permission.resolvedAt ? new Date(permission.resolvedAt) : permission.resolvedAt,
});

export const normalizeChatAcpActivity = (activity?: ChatAcpActivity | null): ChatAcpActivity => ({
  events: (activity?.events ?? []).map(cloneAcpEvent),
  planEntries: (activity?.planEntries ?? []).map(clonePlanEntry),
  permissions: (activity?.permissions ?? []).map(clonePermissionRequest),
});

export const cloneChatAcpActivity = (activity?: ChatAcpActivity | null): ChatAcpActivity | null =>
  activity ? normalizeChatAcpActivity(activity) : null;

export const appendAcpActivityEvent = (
  activity: ChatAcpActivity | null | undefined,
  event: ChatAcpEventInput,
): ChatAcpActivity => {
  const normalizedActivity = normalizeChatAcpActivity(activity);
  return {
    ...normalizedActivity,
    events: appendChatAcpEvent(normalizedActivity.events, event),
  };
};

export const completeAcpActivityTool = (
  activity: ChatAcpActivity | null | undefined,
  activityId: string,
  success: boolean,
  tool?: ChatAcpToolEventData,
): ChatAcpActivity => {
  const normalizedActivity = normalizeChatAcpActivity(activity);
  return {
    ...normalizedActivity,
    events: updateToolCompletionAcpEvent(normalizedActivity.events, activityId, success, tool),
  };
};

export const setAcpActivityPlanEntries = (
  activity: ChatAcpActivity | null | undefined,
  entries: AcpPlanEntry[],
): ChatAcpActivity => ({
  ...normalizeChatAcpActivity(activity),
  planEntries: entries.map(clonePlanEntry),
});

export const addAcpPermissionRequest = (
  activity: ChatAcpActivity | null | undefined,
  permission: Omit<ChatAcpPermissionRequest, "status" | "timestamp" | "resolvedAt">,
): ChatAcpActivity => {
  const normalizedActivity = normalizeChatAcpActivity(activity);
  const nextPermission: ChatAcpPermissionRequest = {
    ...permission,
    status: "pending",
    timestamp: new Date(),
    resolvedAt: null,
  };

  return {
    ...normalizedActivity,
    permissions: [...normalizedActivity.permissions, nextPermission].slice(-MAX_PERMISSION_HISTORY),
  };
};

export const resolveAcpPermissionRequest = (
  activity: ChatAcpActivity | null | undefined,
  requestId: string,
  status: Extract<ChatAcpPermissionRequest["status"], "approved" | "denied">,
): ChatAcpActivity => {
  const normalizedActivity = normalizeChatAcpActivity(activity);
  const now = new Date();

  return {
    ...normalizedActivity,
    permissions: normalizedActivity.permissions.map((permission) =>
      permission.requestId === requestId && permission.status === "pending"
        ? {
            ...permission,
            status,
            resolvedAt: now,
          }
        : permission,
    ),
  };
};

export const markPendingAcpPermissionsStale = (
  activity: ChatAcpActivity | null | undefined,
): ChatAcpActivity => {
  const normalizedActivity = normalizeChatAcpActivity(activity);
  const now = new Date();

  return {
    ...normalizedActivity,
    permissions: normalizedActivity.permissions.map((permission) =>
      permission.status === "pending"
        ? {
            ...permission,
            status: "stale",
            resolvedAt: now,
          }
        : permission,
    ),
  };
};

export const reconcileIdleAcpRestore = (
  activity: ChatAcpActivity | null | undefined,
  status: Pick<AcpAgentStatus, "running" | "sessionActive">,
): { activity: ChatAcpActivity; shouldResetTransientUi: boolean } => {
  const normalizedActivity = normalizeChatAcpActivity(activity);
  const shouldResetTransientUi = !status.running && !status.sessionActive;

  return {
    activity: shouldResetTransientUi
      ? markPendingAcpPermissionsStale(normalizedActivity)
      : normalizedActivity,
    shouldResetTransientUi,
  };
};

export const getPendingAcpPermissions = (
  activity: ChatAcpActivity | null | undefined,
): ChatAcpPermissionRequest[] =>
  normalizeChatAcpActivity(activity).permissions.filter(
    (permission) => permission.status === "pending",
  );

export const getStaleAcpPermissions = (
  activity: ChatAcpActivity | null | undefined,
): ChatAcpPermissionRequest[] =>
  normalizeChatAcpActivity(activity).permissions.filter(
    (permission) => permission.status === "stale",
  );

export const getRecentAcpToolEvents = (
  activity: ChatAcpActivity | null | undefined,
  limit: number = 6,
): ChatAcpEvent[] =>
  normalizeChatAcpActivity(activity)
    .events.filter((event) => event.kind === "tool")
    .slice(-limit)
    .reverse();

export const getAcpPlanEntryCounts = (activity: ChatAcpActivity | null | undefined) => {
  const planEntries = normalizeChatAcpActivity(activity).planEntries;

  return planEntries.reduce(
    (counts, entry) => {
      counts.total += 1;
      if (entry.status === "completed") counts.completed += 1;
      if (entry.status === "in_progress") counts.inProgress += 1;
      if (entry.status === "pending") counts.pending += 1;
      return counts;
    },
    { total: 0, completed: 0, inProgress: 0, pending: 0 },
  );
};
