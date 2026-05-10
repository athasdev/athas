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
  activeFilePath: string | null;
  followableUserId: number | null;
}

export interface CollaborationNoteFile {
  type: "file";
  path: string;
  content: string;
}

export interface CollaborationNoteFolder {
  type: "folder";
  path: string;
}

export type CollaborationNoteItem = CollaborationNoteFile | CollaborationNoteFolder;

export interface CollaborationSidebarModel {
  workspaceName: string;
  channels: CollaborationChannel[];
  selectedChannel: CollaborationChannel | null;
  selectedNote: CollaborationNote | null;
  notesMarkdown: string;
  notesItems: CollaborationNoteItem[];
  onlineCount: number;
  activeMembers: CollaborationSnapshot["members"];
  chatEntries: CollaborationChatEntry[];
  chatGroups: CollaborationChatGroup[];
  participants: CollaborationParticipant[];
  canEditNotes: boolean;
}

const CHAT_LINE_PATTERN = /^-\s+\*\*(.+?)\*\*:\s*(.+)$/;
const THREADS_START_MARKER = "<!-- athas:threads -->";
const THREADS_END_MARKER = "<!-- /athas:threads -->";
const NOTES_START_MARKER = "<!-- athas:notes -->";
const NOTES_END_MARKER = "<!-- /athas:notes -->";
const NOTES_WORKSPACE_START_MARKER = "<!-- athas:notes-workspace";
const NOTES_WORKSPACE_END_MARKER = "/athas:notes-workspace -->";
const COLLABORATION_NOTE_BUFFER_PREFIX = "athas-collaboration://channel/";

function getMarkedSection(contentMarkdown: string, startMarker: string, endMarker: string) {
  const start = contentMarkdown.indexOf(startMarker);
  const end = contentMarkdown.indexOf(endMarker);
  if (start === -1 || end === -1 || end < start) return null;

  return contentMarkdown.slice(start + startMarker.length, end).trim();
}

function splitChannelNoteContent(contentMarkdown: string) {
  const threadsMarkdown = getMarkedSection(
    contentMarkdown,
    THREADS_START_MARKER,
    THREADS_END_MARKER,
  );
  const notesMarkdown = getMarkedSection(contentMarkdown, NOTES_START_MARKER, NOTES_END_MARKER);

  return {
    threadsMarkdown: threadsMarkdown ?? contentMarkdown.trim(),
    notesMarkdown: notesMarkdown ?? "",
  };
}

function buildChannelNoteContent({
  threadsMarkdown,
  notesMarkdown,
}: {
  threadsMarkdown: string;
  notesMarkdown: string;
}) {
  const cleanThreads = threadsMarkdown.trim();
  const cleanNotes = notesMarkdown.trim();

  if (!cleanThreads && !cleanNotes) return "";

  return [
    THREADS_START_MARKER,
    cleanThreads,
    THREADS_END_MARKER,
    "",
    NOTES_START_MARKER,
    cleanNotes,
    NOTES_END_MARKER,
  ].join("\n");
}

function normalizeNotePath(path: string, fallback: string) {
  const cleanPath = path
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment.trim().replace(/[<>:"|?*]/g, ""))
    .filter(Boolean)
    .join("/");

  return cleanPath || fallback;
}

function normalizeNoteFilePath(path: string) {
  const cleanPath = normalizeNotePath(path, "notes.md");
  return cleanPath.endsWith(".md") ? cleanPath : `${cleanPath}.md`;
}

function uniqueNotePath(items: CollaborationNoteItem[], path: string, type: "file" | "folder") {
  const existingPaths = new Set(items.map((item) => `${item.type}:${item.path}`));
  if (!existingPaths.has(`${type}:${path}`)) return path;

  const extension = type === "file" && path.endsWith(".md") ? ".md" : "";
  const basePath = extension ? path.slice(0, -extension.length) : path;
  for (let index = 2; index < 100; index += 1) {
    const nextPath = `${basePath}-${index}${extension}`;
    if (!existingPaths.has(`${type}:${nextPath}`)) return nextPath;
  }

  return `${basePath}-${Date.now()}${extension}`;
}

function getParentFolders(path: string) {
  const segments = path.split("/").filter(Boolean);
  return segments.slice(0, -1).map((_, index) => segments.slice(0, index + 1).join("/"));
}

function sortNoteItems(items: CollaborationNoteItem[]) {
  return [...items].sort((left, right) => {
    const leftDepth = left.path.split("/").length;
    const rightDepth = right.path.split("/").length;
    if (leftDepth !== rightDepth) return leftDepth - rightDepth;
    if (left.type !== right.type) return left.type === "folder" ? -1 : 1;
    return left.path.localeCompare(right.path);
  });
}

function normalizeNoteItems(items: CollaborationNoteItem[]) {
  const itemMap = new Map<string, CollaborationNoteItem>();

  for (const item of items) {
    if (item.type === "folder") {
      const path = normalizeNotePath(item.path, "Notes");
      itemMap.set(`folder:${path}`, { type: "folder", path });
      continue;
    }

    const path = normalizeNoteFilePath(item.path);
    getParentFolders(path).forEach((folderPath) => {
      itemMap.set(`folder:${folderPath}`, { type: "folder", path: folderPath });
    });
    itemMap.set(`file:${path}`, { type: "file", path, content: item.content ?? "" });
  }

  const normalizedItems = sortNoteItems(Array.from(itemMap.values()));
  return normalizedItems.length > 0
    ? normalizedItems
    : [{ type: "file" as const, path: "notes.md", content: "" }];
}

function parseNotesWorkspace(notesMarkdown: string): CollaborationNoteItem[] {
  const start = notesMarkdown.indexOf(NOTES_WORKSPACE_START_MARKER);
  const end = notesMarkdown.indexOf(NOTES_WORKSPACE_END_MARKER);
  if (start !== -1 && end !== -1 && end > start) {
    const json = notesMarkdown.slice(start + NOTES_WORKSPACE_START_MARKER.length, end).trim();
    try {
      const items = JSON.parse(json) as CollaborationNoteItem[];
      const normalizedItems = items
        .map((item) => {
          if (item.type === "folder") {
            return {
              type: "folder" as const,
              path: normalizeNotePath(item.path, "Notes"),
            };
          }

          if (item.type === "file") {
            return {
              type: "file" as const,
              path: normalizeNoteFilePath(item.path),
              content: item.content ?? "",
            };
          }

          return null;
        })
        .filter((item): item is CollaborationNoteItem => Boolean(item));

      return normalizeNoteItems(normalizedItems);
    } catch {
      return [{ type: "file", path: "notes.md", content: notesMarkdown.trim() }];
    }
  }

  const content = notesMarkdown.trim();
  return [{ type: "file", path: "notes.md", content }];
}

function parseMutableNotesWorkspace(notesMarkdown: string) {
  return notesMarkdown.trim() ? parseNotesWorkspace(notesMarkdown) : [];
}

function buildNotesWorkspace(items: CollaborationNoteItem[]) {
  const normalizedItems = normalizeNoteItems(items);

  return [
    NOTES_WORKSPACE_START_MARKER,
    JSON.stringify(normalizedItems, null, 2),
    NOTES_WORKSPACE_END_MARKER,
  ].join("\n");
}

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
        activeFilePath: sessions.find((session) => session.activeFilePath)?.activeFilePath ?? null,
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
  const { threadsMarkdown, notesMarkdown } = splitChannelNoteContent(
    selectedNote?.contentMarkdown ?? "",
  );
  const chatEntries = parseChatEntries(threadsMarkdown);

  return {
    workspaceName: collaboration.workspace?.name ?? "Team workspace",
    channels: collaboration.channels,
    selectedChannel,
    selectedNote,
    notesMarkdown,
    notesItems: parseNotesWorkspace(notesMarkdown),
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
  const { threadsMarkdown, notesMarkdown } = splitChannelNoteContent(contentMarkdown);
  const existing = threadsMarkdown.trimEnd();
  const nextThreadsMarkdown = existing ? `${existing}\n${nextLine}` : nextLine;
  return buildChannelNoteContent({ threadsMarkdown: nextThreadsMarkdown, notesMarkdown });
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

  const { threadsMarkdown, notesMarkdown } = splitChannelNoteContent(contentMarkdown);
  const existing = threadsMarkdown.trimEnd();
  const nextThreadsMarkdown = existing ? `${existing}\n${lines.join("\n")}` : lines.join("\n");
  return buildChannelNoteContent({ threadsMarkdown: nextThreadsMarkdown, notesMarkdown });
}

export function updateCollaborationNotesMarkdown({
  contentMarkdown,
  notesMarkdown,
}: {
  contentMarkdown: string;
  notesMarkdown: string;
}) {
  const { threadsMarkdown } = splitChannelNoteContent(contentMarkdown);
  return buildChannelNoteContent({ threadsMarkdown, notesMarkdown });
}

export function updateCollaborationNoteFile({
  contentMarkdown,
  path,
  fileContent,
}: {
  contentMarkdown: string;
  path: string;
  fileContent: string;
}) {
  const { threadsMarkdown, notesMarkdown } = splitChannelNoteContent(contentMarkdown);
  const notesItems = parseMutableNotesWorkspace(notesMarkdown).map((item) =>
    item.type === "file" && item.path === path ? { ...item, content: fileContent } : item,
  );
  return buildChannelNoteContent({
    threadsMarkdown,
    notesMarkdown: buildNotesWorkspace(notesItems),
  });
}

export function addCollaborationNoteFile({
  contentMarkdown,
  path,
  folderPath,
}: {
  contentMarkdown: string;
  path: string;
  folderPath?: string | null;
}) {
  const { threadsMarkdown, notesMarkdown } = splitChannelNoteContent(contentMarkdown);
  const notesItems = parseMutableNotesWorkspace(notesMarkdown);
  const basePath = folderPath ? `${normalizeNotePath(folderPath, "")}/${path}` : path;
  const nextPath = uniqueNotePath(notesItems, normalizeNoteFilePath(basePath), "file");
  return {
    contentMarkdown: buildChannelNoteContent({
      threadsMarkdown,
      notesMarkdown: buildNotesWorkspace([
        ...notesItems,
        { type: "file", path: nextPath, content: "" },
      ]),
    }),
    path: nextPath,
  };
}

export function addCollaborationNoteFolder({
  contentMarkdown,
  path,
}: {
  contentMarkdown: string;
  path: string;
}) {
  const { threadsMarkdown, notesMarkdown } = splitChannelNoteContent(contentMarkdown);
  const notesItems = parseMutableNotesWorkspace(notesMarkdown);
  const nextPath = uniqueNotePath(notesItems, normalizeNotePath(path, "Notes"), "folder");
  return {
    contentMarkdown: buildChannelNoteContent({
      threadsMarkdown,
      notesMarkdown: buildNotesWorkspace([...notesItems, { type: "folder", path: nextPath }]),
    }),
    path: nextPath,
  };
}

export function renameCollaborationNoteItem({
  contentMarkdown,
  path,
  type,
  nextPath,
}: {
  contentMarkdown: string;
  path: string;
  type: "file" | "folder";
  nextPath: string;
}) {
  const { threadsMarkdown, notesMarkdown } = splitChannelNoteContent(contentMarkdown);
  const notesItems = parseMutableNotesWorkspace(notesMarkdown);
  const normalizedNextPath =
    type === "file" ? normalizeNoteFilePath(nextPath) : normalizeNotePath(nextPath, "Notes");
  const uniqueNextPath = uniqueNotePath(
    notesItems.filter((item) => !(item.type === type && item.path === path)),
    normalizedNextPath,
    type,
  );
  const prefix = `${path}/`;
  const nextItems = notesItems.map((item) => {
    if (type === "file") {
      return item.type === "file" && item.path === path ? { ...item, path: uniqueNextPath } : item;
    }

    if (item.path === path) return { ...item, path: uniqueNextPath };
    if (item.path.startsWith(prefix)) {
      return { ...item, path: `${uniqueNextPath}/${item.path.slice(prefix.length)}` };
    }
    return item;
  });

  return {
    contentMarkdown: buildChannelNoteContent({
      threadsMarkdown,
      notesMarkdown: buildNotesWorkspace(nextItems),
    }),
    path: uniqueNextPath,
  };
}

export function deleteCollaborationNoteItem({
  contentMarkdown,
  path,
  type,
}: {
  contentMarkdown: string;
  path: string;
  type: "file" | "folder";
}) {
  const { threadsMarkdown, notesMarkdown } = splitChannelNoteContent(contentMarkdown);
  const notesItems = parseMutableNotesWorkspace(notesMarkdown);
  const prefix = `${path}/`;
  const nextItems = notesItems.filter((item) => {
    if (type === "file") return !(item.type === "file" && item.path === path);
    return !(item.path === path || item.path.startsWith(prefix));
  });

  return buildChannelNoteContent({
    threadsMarkdown,
    notesMarkdown: buildNotesWorkspace(nextItems),
  });
}

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
