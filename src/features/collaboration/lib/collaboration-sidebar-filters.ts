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
