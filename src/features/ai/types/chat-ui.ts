export interface ChatAcpToolLocation {
  path: string;
  line?: number | null;
}

export interface ChatAcpToolEventData {
  input?: unknown;
  output?: unknown;
  locations?: ChatAcpToolLocation[];
  error?: string;
}

export type HarnessTrustStateKind = "idle" | "running" | "attention" | "error";

export interface HarnessTrustState {
  kind: HarnessTrustStateKind;
  agentLabel: string;
  modeLabel: string;
  stateLabel: string;
  detail: string | null;
  showRailStatus: boolean;
}

export interface ChatAcpEvent {
  id: string;
  kind: "thinking" | "tool" | "plan" | "mode" | "error" | "permission" | "status";
  label: string;
  detail?: string;
  state?: "running" | "success" | "error" | "info";
  tool?: ChatAcpToolEventData;
  timestamp: Date;
}

export interface ChatAcpPermissionRequest {
  requestId: string;
  description: string;
  permissionType: string;
  resource: string;
  title?: string | null;
  placeholder?: string | null;
  defaultValue?: string | null;
  options?: string[] | null;
  status: "pending" | "approved" | "denied" | "stale";
  timestamp: Date;
  resolvedAt?: Date | null;
}
