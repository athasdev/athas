import type { AcpEvent } from "@/features/ai/types/acp.types";

const pending = new Map<string, (approved: boolean) => void>();

export function isIntelligencePermissionPending(requestId: string) {
  return pending.has(requestId);
}

export function respondToIntelligencePermission(requestId: string, approved: boolean) {
  pending.get(requestId)?.(approved);
}

export function requestIntelligencePermission(params: {
  sessionId: string;
  path: string;
  description: string;
  kind?: "edit" | "command";
  signal: AbortSignal;
  notify?: (event: Extract<AcpEvent, { type: "permission_request" }>) => void;
}): Promise<boolean> {
  if (params.signal.aborted || !params.notify) return Promise.resolve(false);
  return new Promise((resolve) => {
    const requestId = `intelligence:${crypto.randomUUID()}`;
    const finish = (approved: boolean) => {
      if (!pending.delete(requestId)) return;
      params.signal.removeEventListener("abort", abort);
      resolve(approved && !params.signal.aborted);
    };
    const abort = () => finish(false);
    pending.set(requestId, finish);
    params.signal.addEventListener("abort", abort, { once: true });
    params.notify!({
      type: "permission_request",
      sessionId: params.sessionId,
      requestId,
      permissionType: `intelligence-${params.kind ?? "edit"}`,
      resource: params.path,
      description: params.description,
      options: [
        { id: "deny", name: "Deny", kind: "reject_once" },
        {
          id: "allow",
          name: params.kind === "command" ? "Run command" : "Apply edit",
          kind: "allow_once",
        },
      ],
    });
  });
}
