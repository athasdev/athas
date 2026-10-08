import type { GitHubDeliveryContent } from "@/features/panes/types/pane-content.types";

export function getViewBufferPath(projectPath: string, viewId?: string): string {
  return viewId
    ? `view://${encodeURIComponent(projectPath)}/${viewId}`
    : `view://create/${encodeURIComponent(projectPath)}`;
}

export function deliveryBufferPath(
  kind: GitHubDeliveryContent["kind"],
  repoPath: string,
  id: number | "new",
) {
  return `github-${kind}://${encodeURIComponent(repoPath)}/${id}`;
}

const COLLABORATION_NOTE_BUFFER_PREFIX = "athas-collaboration://channel/";

export function buildCollaborationNoteBufferPath(channelId: number, notePath: string) {
  return `${COLLABORATION_NOTE_BUFFER_PREFIX}${channelId}/notes/${encodeURIComponent(notePath)}`;
}

export function parseCollaborationNoteBufferPath(path: string): {
  channelId: number;
  notePath: string;
} | null {
  if (!path.startsWith(COLLABORATION_NOTE_BUFFER_PREFIX)) return null;

  const rest = path.slice(COLLABORATION_NOTE_BUFFER_PREFIX.length);
  const [channelIdText, marker, encodedNotePath] = rest.split("/");
  const channelId = Number(channelIdText);
  if (!Number.isInteger(channelId) || marker !== "notes" || !encodedNotePath) return null;

  try {
    return {
      channelId,
      notePath: decodeURIComponent(encodedNotePath),
    };
  } catch {
    return null;
  }
}
