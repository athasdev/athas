import { describe, expect, it } from "vite-plus/test";
import {
  CHANNEL_FILTER_OPTIONS,
  filterCollaborationChannels,
  filterCollaborationNoteItems,
  filterCollaborationParticipants,
  filterCollaborationPrivateChatParticipants,
  matchesCollaborationSearchQuery,
  normalizeCollaborationSearchQuery,
  NOTE_FILTER_OPTIONS,
  PEOPLE_FILTER_OPTIONS,
} from "../lib/collaboration-sidebar-filters";
import type {
  CollaborationChannel,
  CollaborationNoteItem,
  CollaborationParticipant,
} from "../lib/collaboration-sidebar-model";

const channels = [
  {
    id: 1,
    slug: "general",
    description: "Team updates",
    memberCount: 3,
    guestCount: 0,
  },
  {
    id: 2,
    slug: "design",
    description: "Guest reviews",
    memberCount: 1,
    guestCount: 2,
  },
  {
    id: 3,
    slug: "empty-room",
    description: null,
    memberCount: 0,
    guestCount: 0,
  },
] as CollaborationChannel[];

const participants: CollaborationParticipant[] = [
  {
    id: "1",
    name: "Ada",
    role: "Owner",
    online: true,
    microphone: true,
    screen: false,
    activeFilePath: "/repo/app.ts",
    followableUserId: 1,
  },
  {
    id: "2",
    name: "Grace",
    role: "Member",
    online: false,
    microphone: false,
    screen: false,
    activeFilePath: null,
    followableUserId: 2,
  },
];

describe("collaboration sidebar filters", () => {
  it("normalizes search once for every sidebar section", () => {
    expect(normalizeCollaborationSearchQuery("  Mehmet Özgül ")).toBe("mehmet özgül");
    expect(matchesCollaborationSearchQuery("özg", [12, "Mehmet Özgül", false])).toBe(true);
    expect(matchesCollaborationSearchQuery("missing", [12, null, false])).toBe(false);
    expect(matchesCollaborationSearchQuery("", [])).toBe(true);
  });

  it("keeps each section's supported filters explicit", () => {
    expect(CHANNEL_FILTER_OPTIONS.map((option) => option.id)).toEqual([
      "all",
      "active",
      "with-guests",
      "empty",
    ]);
    expect(PEOPLE_FILTER_OPTIONS.map((option) => option.id)).toEqual([
      "all",
      "online",
      "offline",
      "sharing",
      "has-file",
    ]);
    expect(NOTE_FILTER_OPTIONS.map((option) => option.id)).toEqual(["notes", "secrets", "all"]);
  });

  it("combines channel filters with normalized search", () => {
    expect(
      filterCollaborationChannels({
        channels,
        filter: "with-guests",
        query: "  DESIGN ",
        selectedChannelId: 1,
      }).map((channel) => channel.id),
    ).toEqual([2]);
    expect(
      filterCollaborationChannels({
        channels,
        filter: "active",
        query: "",
        selectedChannelId: 1,
      }).map((channel) => channel.id),
    ).toEqual([1]);
    expect(
      filterCollaborationChannels({
        channels,
        filter: "active",
        query: "",
        selectedChannelId: null,
      }),
    ).toEqual([]);
    expect(
      filterCollaborationChannels({
        channels,
        filter: "empty",
        query: "room",
      }).map((channel) => channel.id),
    ).toEqual([3]);
  });

  it("filters people and private chats through their distinct rules", () => {
    expect(
      filterCollaborationParticipants({
        participants,
        filter: "sharing",
        query: "owner",
      }).map((participant) => participant.id),
    ).toEqual(["1"]);
    expect(
      filterCollaborationParticipants({
        participants,
        filter: "offline",
        query: "grace",
      }).map((participant) => participant.id),
    ).toEqual(["2"]);
    expect(
      filterCollaborationPrivateChatParticipants({
        participants,
        channelFilter: "active",
        query: "",
      }),
    ).toEqual([]);
    expect(
      filterCollaborationPrivateChatParticipants({
        participants,
        channelFilter: "all",
        query: "app.ts",
      }).map((participant) => participant.id),
    ).toEqual(["1"]);
  });

  it("keeps secret filtering separate from note search", () => {
    const items: CollaborationNoteItem[] = [
      { type: "folder", path: "Docs" },
      { type: "file", path: "Docs/plan.md", content: "Launch checklist" },
    ];

    expect(filterCollaborationNoteItems({ items, filter: "notes", query: "launch" })).toEqual([
      items[1],
    ]);
    expect(filterCollaborationNoteItems({ items, filter: "secrets", query: "" })).toEqual([]);
  });
});
