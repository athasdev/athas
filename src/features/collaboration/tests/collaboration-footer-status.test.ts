import { describe, expect, it } from "vite-plus/test";
import type { SubscriptionInfo } from "@/features/window/services/auth-api";
import { buildCollaborationFooterStatus } from "../lib/collaboration-footer-status";

function collaborationSnapshot(
  overrides: Partial<NonNullable<SubscriptionInfo["collaboration"]>> = {},
): NonNullable<SubscriptionInfo["collaboration"]> {
  return {
    enabled: true,
    workspace: {
      id: 1,
      name: "Mehmet's team",
      slug: "mehmet",
      role: "owner",
      visibility: "workspace",
      realtimeProtocolVersion: 1,
    },
    members: [],
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
    channelNotes: [],
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

describe("buildCollaborationFooterStatus", () => {
  it("hides the footer item when collaboration is unavailable", () => {
    expect(
      buildCollaborationFooterStatus({
        collaboration: undefined,
        presenceTarget: { channelId: null },
        activeDocumentStream: {
          status: "idle",
          path: null,
          updatesReceived: 0,
        },
      }),
    ).toBeNull();
  });

  it("summarizes channel, online count, and live sync compactly", () => {
    const status = buildCollaborationFooterStatus({
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
            activeFilePath: "src/main.ts",
            cursorLabel: null,
            heartbeatAt: null,
          },
        ],
      }),
      presenceTarget: { channelId: 10 },
      activeDocumentStream: {
        status: "live",
        path: "src/main.ts",
        updatesReceived: 2,
      },
    });

    expect(status).toMatchObject({
      label: "#general",
      countLabel: "1",
      tone: "live",
      active: true,
    });
    expect(status?.tooltip).toContain("Mehmet's team · 1 online");
  });
});
