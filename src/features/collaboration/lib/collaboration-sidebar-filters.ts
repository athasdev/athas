import type {
  CollaborationChannel,
  CollaborationNoteItem,
  CollaborationParticipant,
} from "./collaboration-sidebar-model";

export type CollaborationChannelFilter = "all" | "active" | "with-guests" | "empty";
export type CollaborationPeopleFilter = "all" | "online" | "offline" | "sharing" | "has-file";
export type CollaborationNotesFilter = "notes" | "secrets" | "all";

interface CollaborationFilterOption<T extends string> {
  id: T;
  label: string;
}

export const CHANNEL_FILTER_OPTIONS: Array<CollaborationFilterOption<CollaborationChannelFilter>> =
  [
    { id: "all", label: "All" },
    { id: "active", label: "Active" },
    { id: "with-guests", label: "With guests" },
    { id: "empty", label: "Empty" },
  ];

export const PEOPLE_FILTER_OPTIONS: Array<CollaborationFilterOption<CollaborationPeopleFilter>> = [
  { id: "all", label: "All" },
  { id: "online", label: "Online" },
  { id: "offline", label: "Offline" },
  { id: "sharing", label: "Sharing" },
  { id: "has-file", label: "Has file" },
];

export const NOTE_FILTER_OPTIONS: Array<CollaborationFilterOption<CollaborationNotesFilter>> = [
  { id: "notes", label: "Notes" },
  { id: "secrets", label: "Secrets" },
  { id: "all", label: "All" },
];

export function normalizeCollaborationSearchQuery(query: string) {
  return query.trim().toLowerCase();
}

export function matchesCollaborationSearchQuery(
  query: string,
  values: Array<string | number | boolean | null | undefined>,
) {
  if (!query) return true;
  return values.some((value) =>
    String(value ?? "")
      .toLowerCase()
      .includes(query),
  );
}

export function filterCollaborationChannels({
  channels,
  filter,
  query,
  selectedChannelId,
}: {
  channels: CollaborationChannel[];
  filter: CollaborationChannelFilter;
  query: string;
  selectedChannelId?: number | null;
}) {
  const search = normalizeCollaborationSearchQuery(query);
  const filtered = channels.filter((channel) => {
    if (filter === "active" && channel.id !== selectedChannelId) return false;
    if (filter === "with-guests" && channel.guestCount === 0) return false;
    if (filter === "empty" && (channel.memberCount > 0 || channel.guestCount > 0)) return false;

    return matchesCollaborationSearchQuery(search, [
      channel.slug,
      channel.description,
      channel.memberCount,
      channel.guestCount,
      channel.id,
    ]);
  });

  return filter === "active" && selectedChannelId == null ? [] : filtered;
}

export function filterCollaborationParticipants({
  participants,
  filter,
  query,
}: {
  participants: CollaborationParticipant[];
  filter: CollaborationPeopleFilter;
  query: string;
}) {
  const search = normalizeCollaborationSearchQuery(query);
  return participants.filter((participant) => {
    if (filter === "online" && !participant.online) return false;
    if (filter === "offline" && participant.online) return false;
    if (filter === "sharing" && !participant.microphone && !participant.screen) return false;
    if (filter === "has-file" && !participant.activeFilePath) return false;

    return matchesCollaborationSearchQuery(search, [
      participant.name,
      participant.role,
      participant.activeFilePath,
      participant.online ? "online" : "offline",
      participant.microphone ? "microphone" : null,
      participant.screen ? "screen" : null,
    ]);
  });
}

export function filterCollaborationPrivateChatParticipants({
  participants,
  channelFilter,
  query,
}: {
  participants: CollaborationParticipant[];
  channelFilter: CollaborationChannelFilter;
  query: string;
}) {
  if (channelFilter !== "all") return [];

  const search = normalizeCollaborationSearchQuery(query);
  return participants.filter((participant) =>
    matchesCollaborationSearchQuery(search, [
      participant.name,
      participant.role,
      participant.online ? "online" : "offline",
      participant.activeFilePath,
    ]),
  );
}

export function filterCollaborationNoteItems({
  items,
  filter,
  query,
}: {
  items: CollaborationNoteItem[];
  filter: CollaborationNotesFilter;
  query: string;
}) {
  if (filter === "secrets") return [];

  const search = normalizeCollaborationSearchQuery(query);
  return items.filter((item) =>
    matchesCollaborationSearchQuery(search, [
      item.path,
      item.type,
      item.type === "file" ? item.content : null,
    ]),
  );
}
