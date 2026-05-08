import { describe, expect, it } from "vite-plus/test";
import type { SubscriptionInfo } from "@/features/window/services/auth-api";
import {
  appendCollaborationChatMessage,
  appendCollaborationSharedDocuments,
  buildCollaborationSidebarModel,
} from "../lib/collaboration-sidebar-model";

function collaborationSnapshot(
  overrides: Partial<NonNullable<SubscriptionInfo["collaboration"]>> = {},
): NonNullable<SubscriptionInfo["collaboration"]> {
  return {
    enabled: true,
    workspace: {
      id: 1,
      name: "Athas Team",
      slug: "athas-team",
      role: "owner",
      visibility: "workspace",
      realtimeProtocolVersion: 1,
    },
    members: [
      {
        id: 1,
        userId: 1,
        name: "Mehmet",
        email: "mehmet@example.com",
        role: "owner",
        status: "active",
        lastSeenAt: null,
      },
    ],
    invitations: [],
    projects: [],
    channels: [
      {
        id: 10,
        name: "General",
        slug: "general",
        description: null,
        visibility: "workspace",
        parentChannelId: null,
        memberCount: 1,
        guestCount: 0,
        noteVersion: 1,
        notePreview: "",
        updatedAt: null,
      },
    ],
    channelNotes: [
      {
        channelId: 10,
        contentMarkdown: "- **Mehmet**: Ship the sidebar",
        version: 1,
        updatedAt: null,
      },
    ],
    channelGuests: [],
    settings: null,
    activity: [],
    presence: [],
    documents: [],
    documentUpdates: [],
    mediaSignals: [],
    capabilities: {
      canInvite: true,
      canManageMembers: true,
      canShareProjects: true,
      canCreateChannels: true,
      canEditChannelNotes: true,
      activityFeed: true,
      presence: true,
      realtimeDocuments: true,
    },
    ...overrides,
  };
}

describe("collaboration sidebar model", () => {
  it("selects a channel and parses note-backed chat entries", () => {
    const model = buildCollaborationSidebarModel({
      collaboration: collaborationSnapshot(),
      selectedChannelId: 10,
    });

    expect(model?.workspaceName).toBe("Athas Team");
    expect(model?.selectedChannel?.slug).toBe("general");
    expect(model?.chatEntries).toEqual([
      {
        id: "0-Mehmet",
        author: "Mehmet",
        body: "Ship the sidebar",
        kind: "message",
      },
    ]);
    expect(model?.chatGroups).toHaveLength(1);
  });

  it("builds compact participants with media state from presence", () => {
    const model = buildCollaborationSidebarModel({
      collaboration: collaborationSnapshot({
        presence: [
          {
            id: 1,
            userId: 1,
            channelId: 10,
            channelName: "General",
            channelSlug: "general",
            followingUserId: null,
            followingUserName: null,
            deviceId: "desktop",
            status: "online",
            activeFilePath: null,
            cursorLabel: "mic,screen",
            heartbeatAt: null,
          },
        ],
      }),
      selectedChannelId: 10,
    });

    expect(model?.participants[0]).toMatchObject({
      name: "Mehmet",
      online: true,
      microphone: true,
      screen: true,
    });
  });

  it("appends compact markdown chat lines", () => {
    expect(
      appendCollaborationChatMessage({
        contentMarkdown: "- **Mehmet**: First",
        author: "Teammate",
        message: "  second   message ",
      }),
    ).toBe("- **Mehmet**: First\n- **Teammate**: second message");
  });

  it("appends non-code document shares as compact chat lines", () => {
    expect(
      appendCollaborationSharedDocuments({
        contentMarkdown: "",
        author: "Mehmet",
        documentNames: ["Roadmap.pdf", "Meeting Notes.docx"],
      }),
    ).toBe(
      "- **Mehmet**: shared document: Roadmap.pdf\n- **Mehmet**: shared document: Meeting Notes.docx",
    );
  });
});
