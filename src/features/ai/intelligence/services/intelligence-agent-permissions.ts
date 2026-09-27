import type { AcpEvent, AcpPermissionPreview } from "@/features/ai/types/acp.types";

/** How the user answered: `always` is set when they chose the remembered option. */
export interface IntelligencePermissionDecision {
  approved: boolean;
  always: boolean;
}

const ALLOW_ALWAYS_OPTION = "allow_always";
const pending = new Map<string, (decision: IntelligencePermissionDecision) => void>();

export function isIntelligencePermissionPending(requestId: string) {
  return pending.has(requestId);
}

export function respondToIntelligencePermission(
  requestId: string,
  approved: boolean,
  optionId?: string,
) {
  pending.get(requestId)?.({ approved, always: approved && optionId === ALLOW_ALWAYS_OPTION });
}

export function requestIntelligencePermission(params: {
  sessionId: string;
  path: string;
  description: string;
  kind?: "edit" | "command" | "delete" | "mcp";
  preview?: AcpPermissionPreview;
  /** Offers an "always allow" answer with this label, such as `Always allow bun test`. */
  allowAlwaysLabel?: string;
  signal: AbortSignal;
  notify?: (event: Extract<AcpEvent, { type: "permission_request" }>) => void;
}): Promise<IntelligencePermissionDecision> {
  const denied = { approved: false, always: false };
  if (params.signal.aborted || !params.notify) return Promise.resolve(denied);
  return new Promise((resolve) => {
    const requestId = `intelligence:${crypto.randomUUID()}`;
    const finish = (decision: IntelligencePermissionDecision) => {
      if (!pending.delete(requestId)) return;
      params.signal.removeEventListener("abort", abort);
      resolve(params.signal.aborted ? denied : decision);
    };
    const abort = () => finish(denied);
    pending.set(requestId, finish);
    params.signal.addEventListener("abort", abort, { once: true });
    const kind = params.kind ?? "edit";
    params.notify!({
      type: "permission_request",
      sessionId: params.sessionId,
      requestId,
      permissionType: `intelligence-${kind}`,
      resource: params.path,
      description: params.description,
      preview: params.preview,
      options: [
        { id: "deny", name: "Deny", kind: "reject_once" },
        {
          id: "allow",
          name:
            kind === "command"
              ? "Run command"
              : kind === "delete"
                ? "Delete file"
                : kind === "mcp"
                  ? "Run tool"
                  : "Apply edit",
          kind: "allow_once",
        },
        ...(params.allowAlwaysLabel
          ? [
              {
                id: ALLOW_ALWAYS_OPTION,
                name: params.allowAlwaysLabel,
                kind: "allow_always" as const,
              },
            ]
          : []),
      ],
    });
  });
}
