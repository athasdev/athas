import { toast } from "sonner";
import type { OpenContentSpec } from "@/features/panes/types/pane-content.types";
import { useProjectStore } from "@/features/window/stores/project.store";
import { type DetachedWindowHandle, openDetachedWindow } from "./detached-window-owner";
import type { DetachedWindowBaseMessage } from "./detached-window-protocol";

export type ResourceWindowMessage = DetachedWindowBaseMessage;

export interface ResourceWindowPayload {
  workspacePath: string | undefined;
  content: OpenContentSpec;
}

export function parseResourceWindowPayload(payload: string | null): ResourceWindowPayload | null {
  if (!payload) return null;
  try {
    const parsed = JSON.parse(payload) as Partial<ResourceWindowPayload>;
    if (!parsed.content || typeof parsed.content !== "object") return null;
    return { workspacePath: parsed.workspacePath, content: parsed.content };
  } catch {
    return null;
  }
}

const windows = new Map<string, DetachedWindowHandle<ResourceWindowMessage>>();

/** One window per resource: reopening a resource focuses the window it already has. */
export function getResourceWindowKey(content: OpenContentSpec): string {
  switch (content.type) {
    case "pullRequest":
      return `pullRequest:${content.repoPath ?? ""}:${content.prNumber}`;
    case "githubIssue":
      return `githubIssue:${content.repoPath ?? ""}:${content.issueNumber}`;
    case "githubAction":
      return `githubAction:${content.repoPath ?? ""}:${content.runId ?? content.url ?? ""}`;
    case "githubDelivery":
      return `githubDelivery:${content.repoPath}:${content.kind}:${content.resourceId ?? ""}`;
    default:
      return JSON.stringify(content);
  }
}

export function openResourceInDetachedWindow(
  content: OpenContentSpec,
  workspacePath: string | undefined = useProjectStore.getState().rootFolderPath,
) {
  const key = getResourceWindowKey(content);
  const existing = windows.get(key);
  if (existing) {
    existing.post({ type: "focus" });
    return existing.opened;
  }

  const forget = () => {
    if (windows.get(key) === handle) windows.delete(key);
  };
  const payload: ResourceWindowPayload = { workspacePath, content };
  const handle = openDetachedWindow<ResourceWindowMessage>({
    kind: "resource",
    payload: JSON.stringify(payload),
    onMessage: (message, handle) => {
      if (message.type === "ready") handle.markInitialized();
    },
    onDestroyed: forget,
    onOpenTimeout: () => {
      forget();
      toast.error("The window did not finish opening.");
    },
    onError: (error) => {
      forget();
      toast.error(`Could not open a new window: ${String(error)}`);
    },
  });
  windows.set(key, handle);
  return handle.opened;
}
