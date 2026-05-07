import type { SubscriptionInfo } from "@/features/window/services/auth-api";

type CollaborationSnapshot = NonNullable<SubscriptionInfo["collaboration"]>;

interface CollaborationPresenceTarget {
  channelId: number | null;
}

interface CollaborationDocumentStreamSummary {
  status: "idle" | "connecting" | "live" | "reconnecting" | "error";
  path: string | null;
  updatesReceived: number;
}

export interface CollaborationFooterStatus {
  label: string;
  countLabel: string | null;
  tooltip: string;
  tone: "idle" | "connecting" | "live" | "error";
  active: boolean;
}

function getChannelLabel(
  collaboration: CollaborationSnapshot,
  presenceTarget: CollaborationPresenceTarget,
) {
  const channel =
    collaboration.channels.find((entry) => entry.id === presenceTarget.channelId) ??
    collaboration.channels[0];

  if (!channel) return "Team";
  return `#${channel.slug || channel.name}`;
}

function getStreamLabel(stream: CollaborationDocumentStreamSummary) {
  if (stream.status === "live") return "Live document sync";
  if (stream.status === "connecting" || stream.status === "reconnecting") return "Connecting";
  if (stream.status === "error") return "Sync needs attention";
  return "Presence ready";
}

export function buildCollaborationFooterStatus({
  collaboration,
  presenceTarget,
  activeDocumentStream,
}: {
  collaboration: SubscriptionInfo["collaboration"] | undefined;
  presenceTarget: CollaborationPresenceTarget;
  activeDocumentStream: CollaborationDocumentStreamSummary;
}): CollaborationFooterStatus | null {
  if (!collaboration?.enabled) return null;

  const onlineSessions = collaboration.presence.filter((entry) => entry.status === "online");
  const workspaceName = collaboration.workspace?.name ?? "Team workspace";
  const channelLabel = getChannelLabel(collaboration, presenceTarget);
  const countLabel = onlineSessions.length > 0 ? String(onlineSessions.length) : null;
  const streamLabel = getStreamLabel(activeDocumentStream);
  const tone =
    activeDocumentStream.status === "error"
      ? "error"
      : activeDocumentStream.status === "connecting" ||
          activeDocumentStream.status === "reconnecting"
        ? "connecting"
        : activeDocumentStream.status === "live"
          ? "live"
          : "idle";

  return {
    label: channelLabel,
    countLabel,
    tone,
    active: activeDocumentStream.status === "live",
    tooltip: `${workspaceName} · ${onlineSessions.length} online · ${streamLabel}`,
  };
}
