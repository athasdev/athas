import type { SubscriptionInfo } from "@/features/window/services/auth-api";

type CollaborationSnapshot = NonNullable<SubscriptionInfo["collaboration"]>;
type CollaborationChannel = CollaborationSnapshot["channels"][number];
type CollaborationNote = CollaborationSnapshot["channelNotes"][number];

export interface CollaborationChatEntry {
  id: string;
  author: string;
  body: string;
  kind: "message" | "document";
}

export interface CollaborationChatGroup {
  id: string;
  author: string;
  entries: CollaborationChatEntry[];
}

export interface CollaborationParticipant {
  id: string;
  name: string;
  role: string;
  online: boolean;
  microphone: boolean;
  screen: boolean;
  followableUserId: number | null;
}

export interface CollaborationSidebarModel {
  workspaceName: string;
  channels: CollaborationChannel[];
  selectedChannel: CollaborationChannel | null;
  selectedNote: CollaborationNote | null;
  onlineCount: number;
  activeMembers: CollaborationSnapshot["members"];
  chatEntries: CollaborationChatEntry[];
  chatGroups: CollaborationChatGroup[];
  participants: CollaborationParticipant[];
  canEditNotes: boolean;
}

const CHAT_LINE_PATTERN = /^-\s+\*\*(.+?)\*\*:\s*(.+)$/;

function parseChatEntries(contentMarkdown: string): CollaborationChatEntry[] {
  return contentMarkdown
    .split("\n")
    .map((line, index) => {
      const match = line.match(CHAT_LINE_PATTERN);
      if (!match) return null;
      return {
        id: `${index}-${match[1]}`,
        author: match[1].trim(),
        body: match[2].trim(),
        kind: match[2].includes("shared document:") ? "document" : "message",
      };
    })
    .filter((entry): entry is CollaborationChatEntry => Boolean(entry));
}

function groupChatEntries(entries: CollaborationChatEntry[]): CollaborationChatGroup[] {
  return entries.reduce<CollaborationChatGroup[]>((groups, entry) => {
    const lastGroup = groups[groups.length - 1];
    if (lastGroup?.author === entry.author) {
      lastGroup.entries.push(entry);
      return groups;
    }

    groups.push({
      id: entry.id,
      author: entry.author,
      entries: [entry],
    });
    return groups;
  }, []);
}

function buildParticipants(collaboration: CollaborationSnapshot): CollaborationParticipant[] {
  return collaboration.members
    .filter((member) => member.status === "active")
    .map((member) => {
      const sessions = collaboration.presence.filter(
        (presence) => presence.userId === member.userId && presence.status === "online",
      );
      const mediaLabels = sessions.flatMap((presence) =>
        (presence.cursorLabel ?? "")
          .split(",")
          .map((label) => label.trim())
          .filter(Boolean),
      );

      return {
        id: String(member.id),
        name: member.name,
        role: member.role,
        online: sessions.length > 0,
        microphone: mediaLabels.includes("mic"),
        screen: mediaLabels.includes("screen"),
        followableUserId: member.userId,
      };
    });
}

export function buildCollaborationSidebarModel({
  collaboration,
  selectedChannelId,
}: {
  collaboration: SubscriptionInfo["collaboration"] | undefined;
  selectedChannelId: number | null;
}): CollaborationSidebarModel | null {
  if (!collaboration?.enabled) return null;

  const selectedChannel =
    collaboration.channels.find((channel) => channel.id === selectedChannelId) ??
    collaboration.channels[0] ??
    null;
  const selectedNote = selectedChannel
    ? (collaboration.channelNotes.find((note) => note.channelId === selectedChannel.id) ?? null)
    : null;
  const chatEntries = parseChatEntries(selectedNote?.contentMarkdown ?? "");

  return {
    workspaceName: collaboration.workspace?.name ?? "Team workspace",
    channels: collaboration.channels,
    selectedChannel,
    selectedNote,
    onlineCount: collaboration.presence.filter((presence) => presence.status === "online").length,
    activeMembers: collaboration.members.filter((member) => member.status === "active"),
    chatEntries,
    chatGroups: groupChatEntries(chatEntries),
    participants: buildParticipants(collaboration),
    canEditNotes: collaboration.capabilities.canEditChannelNotes,
  };
}

export function appendCollaborationChatMessage({
  contentMarkdown,
  author,
  message,
}: {
  contentMarkdown: string;
  author: string;
  message: string;
}) {
  const cleanMessage = message.replace(/\s+/g, " ").trim();
  if (!cleanMessage) return contentMarkdown.trimEnd();

  const cleanAuthor = author.replace(/\*/g, "").trim() || "Member";
  const nextLine = `- **${cleanAuthor}**: ${cleanMessage}`;
  const existing = contentMarkdown.trimEnd();
  return existing ? `${existing}\n${nextLine}` : nextLine;
}

export function appendCollaborationSharedDocuments({
  contentMarkdown,
  author,
  documentNames,
}: {
  contentMarkdown: string;
  author: string;
  documentNames: string[];
}) {
  const cleanAuthor = author.replace(/\*/g, "").trim() || "Member";
  const lines = documentNames
    .map((name) => name.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((name) => `- **${cleanAuthor}**: shared document: ${name}`);

  if (lines.length === 0) return contentMarkdown.trimEnd();

  const existing = contentMarkdown.trimEnd();
  return existing ? `${existing}\n${lines.join("\n")}` : lines.join("\n");
}
