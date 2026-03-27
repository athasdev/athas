import type { ChatMode } from "@/features/ai/store/types";
import type { AgentType } from "@/features/ai/types/ai-chat";
import type { ChatAcpEvent, HarnessTrustState } from "@/features/ai/types/chat-ui";

export interface HarnessTrustStateInput {
  agentId: AgentType;
  mode: ChatMode;
  isRunning: boolean;
  queueCount: number;
  pendingPermissionCount: number;
  stalePermissionCount: number;
  latestEvent: ChatAcpEvent | null;
}

const getAgentLabel = (agentId: AgentType): string => {
  switch (agentId) {
    case "claude-code":
      return "Claude";
    case "gemini-cli":
      return "Gemini";
    case "codex-cli":
      return "Codex";
    case "pi":
      return "Pi";
    case "custom":
      return "API";
    default:
      return agentId.split("-")[0] ?? "Agent";
  }
};

const getModeLabel = (mode: ChatMode): string => (mode === "plan" ? "Plan" : "Chat");

const formatQueueDetail = (queueCount: number): string | null => {
  if (queueCount <= 0) {
    return null;
  }

  return queueCount === 1 ? "1 queued follow-up" : `${queueCount} queued follow-ups`;
};

const getEventDetail = (event: ChatAcpEvent | null): string | null => {
  if (!event) {
    return null;
  }

  const detail = event.detail?.trim();
  if (detail) {
    return detail;
  }

  const label = event.label.trim();
  return label.length > 0 ? label : null;
};

export const getHarnessTrustState = ({
  agentId,
  mode,
  isRunning,
  queueCount,
  pendingPermissionCount,
  stalePermissionCount,
  latestEvent,
}: HarnessTrustStateInput): HarnessTrustState => {
  if (pendingPermissionCount > 0) {
    return {
      kind: "attention",
      agentLabel: getAgentLabel(agentId),
      modeLabel: getModeLabel(mode),
      stateLabel: "Permission needed",
      detail:
        pendingPermissionCount === 1
          ? "1 decision is waiting"
          : `${pendingPermissionCount} decisions are waiting`,
      showRailStatus: true,
    };
  }

  if (stalePermissionCount > 0) {
    return {
      kind: "attention",
      agentLabel: getAgentLabel(agentId),
      modeLabel: getModeLabel(mode),
      stateLabel: "Permission expired",
      detail:
        stalePermissionCount === 1
          ? "1 request needs to be re-run"
          : `${stalePermissionCount} requests need to be re-run`,
      showRailStatus: true,
    };
  }

  if (isRunning || queueCount > 0) {
    return {
      kind: "running",
      agentLabel: getAgentLabel(agentId),
      modeLabel: getModeLabel(mode),
      stateLabel: "Running",
      detail: formatQueueDetail(queueCount) ?? getEventDetail(latestEvent) ?? "Working now",
      showRailStatus: true,
    };
  }

  if (latestEvent?.kind === "error" || latestEvent?.state === "error") {
    return {
      kind: "error",
      agentLabel: getAgentLabel(agentId),
      modeLabel: getModeLabel(mode),
      stateLabel: "Needs attention",
      detail: getEventDetail(latestEvent) ?? "The last run ended with an error",
      showRailStatus: true,
    };
  }

  return {
    kind: "idle",
    agentLabel: getAgentLabel(agentId),
    modeLabel: getModeLabel(mode),
    stateLabel: "Idle",
    detail: null,
    showRailStatus: false,
  };
};
