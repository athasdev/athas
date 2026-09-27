import type { AcpEvent, AcpPermissionPreview } from "@/features/ai/types/acp.types";

/** A permission prompt as the chat shows it. */
export interface AgentPermissionRequest {
  requestId: string;
  description: string;
  permissionType: string;
  resource: string;
  options: Extract<AcpEvent, { type: "permission_request" }>["options"];
  preview?: AcpPermissionPreview;
}

/** Who is waiting on the answer: an ACP agent, the Codex integration, or Athas's own agent. */
export type AgentPermissionResponder = "acp" | "codex" | "intelligence";

export interface PendingAgentPermission extends AgentPermissionRequest {
  chatId: string;
  responder: AgentPermissionResponder;
}
