import { describe, expect, it } from "vite-plus/test";
import type { SubscriptionInfo } from "@/features/window/services/auth-api";
import {
  appendCollaborationChatMessage,
  appendCollaborationSharedDocuments,
  addCollaborationNoteFile,
  addCollaborationNoteFolder,
  buildCollaborationSidebarModel,
  deleteCollaborationNoteItem,
  renameCollaborationNoteItem,
  updateCollaborationNoteFile,
  updateCollaborationNotesMarkdown,
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
    privateChats: [],
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
    expect(model?.notesMarkdown).toBe("");
    expect(model?.notesItems).toEqual([{ type: "file", path: "notes.md", content: "" }]);
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
    ).toBe(
      [
        "<!-- athas:threads -->",
        "- **Mehmet**: First",
        "- **Teammate**: second message",
        "<!-- /athas:threads -->",
        "",
        "<!-- athas:notes -->",
        "",
        "<!-- /athas:notes -->",
      ].join("\n"),
    );
  });

  it("appends non-code document shares as compact chat lines", () => {
    expect(
      appendCollaborationSharedDocuments({
        contentMarkdown: "",
        author: "Mehmet",
        documentNames: ["Roadmap.pdf", "Meeting Notes.docx"],
      }),
    ).toBe(
      [
        "<!-- athas:threads -->",
        "- **Mehmet**: shared document: Roadmap.pdf",
        "- **Mehmet**: shared document: Meeting Notes.docx",
        "<!-- /athas:threads -->",
        "",
        "<!-- athas:notes -->",
        "",
        "<!-- /athas:notes -->",
      ].join("\n"),
    );
  });

  it("stores notes separately from thread lines", () => {
    const contentMarkdown = updateCollaborationNotesMarkdown({
      contentMarkdown: "- **Mehmet**: First",
      notesMarkdown: "## Plan\n\nShip the sidebar tabs.",
    });
    const model = buildCollaborationSidebarModel({
      collaboration: collaborationSnapshot({
        channelNotes: [{ channelId: 10, contentMarkdown, version: 1, updatedAt: null }],
      }),
      selectedChannelId: 10,
    });

    expect(model?.chatEntries).toHaveLength(1);
    expect(model?.notesItems).toEqual([
      { type: "file", path: "notes.md", content: "## Plan\n\nShip the sidebar tabs." },
    ]);
  });

  it("adds folders and markdown files to the notes workspace", () => {
    const withFolder = addCollaborationNoteFolder({
      contentMarkdown: "",
      path: "docs",
    });
    const withFile = addCollaborationNoteFile({
      contentMarkdown: withFolder.contentMarkdown,
      path: "docs/plan",
    });
    const withContent = updateCollaborationNoteFile({
      contentMarkdown: withFile.contentMarkdown,
      path: withFile.path,
      fileContent: "# Plan",
    });
    const model = buildCollaborationSidebarModel({
      collaboration: collaborationSnapshot({
        channelNotes: [
          { channelId: 10, contentMarkdown: withContent, version: 1, updatedAt: null },
        ],
      }),
      selectedChannelId: 10,
    });

    expect(withFile.path).toBe("docs/plan.md");
    expect(model?.notesItems).toContainEqual({ type: "folder", path: "docs" });
    expect(model?.notesItems).toContainEqual({
      type: "file",
      path: "docs/plan.md",
      content: "# Plan",
    });
  });

  it("auto-creates parent folders for nested markdown files", () => {
    const withFile = addCollaborationNoteFile({
      contentMarkdown: "",
      path: "docs/release/checklist",
    });
    const model = buildCollaborationSidebarModel({
      collaboration: collaborationSnapshot({
        channelNotes: [
          { channelId: 10, contentMarkdown: withFile.contentMarkdown, version: 1, updatedAt: null },
        ],
      }),
      selectedChannelId: 10,
    });

    expect(model?.notesItems).toEqual([
      { type: "folder", path: "docs" },
      { type: "folder", path: "docs/release" },
      { type: "file", path: "docs/release/checklist.md", content: "" },
    ]);
  });

  it("renames and deletes note workspace items", () => {
    const withFile = addCollaborationNoteFile({
      contentMarkdown: "",
      path: "docs/plan",
    });
    const renamed = renameCollaborationNoteItem({
      contentMarkdown: withFile.contentMarkdown,
      type: "folder",
      path: "docs",
      nextPath: "planning",
    });
    const deleted = deleteCollaborationNoteItem({
      contentMarkdown: renamed.contentMarkdown,
      type: "file",
      path: "planning/plan.md",
    });
    const model = buildCollaborationSidebarModel({
      collaboration: collaborationSnapshot({
        channelNotes: [{ channelId: 10, contentMarkdown: deleted, version: 1, updatedAt: null }],
      }),
      selectedChannelId: 10,
    });

    expect(renamed.path).toBe("planning");
    expect(model?.notesItems).toEqual([{ type: "folder", path: "planning" }]);
  });
});
