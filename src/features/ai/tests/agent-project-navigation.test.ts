import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  activeProjectId: "project-a",
  switchResult: true,
  calls: [] as string[],
  chats: [
    { id: "chat-a", workspacePath: "/work/a" },
    { id: "chat-b", workspacePath: "/work/b/" },
  ],
  createNewChat: vi.fn(() => "new-chat"),
  setPendingAgentLaunchRequest: vi.fn(),
}));

vi.mock("@/features/workspace/services/workspace-runtime-registry", () => ({
  workspaceRuntimeRegistry: { getActiveWorkspaceId: () => mocks.activeProjectId },
}));
vi.mock("@/features/workspace/stores/workspace-tabs.store", () => ({
  useWorkspaceTabsStore: {
    getState: () => ({
      projectTabs: [
        { id: "project-a", path: "/work/a" },
        { id: "project-b", path: "/work/b" },
      ],
    }),
  },
}));
vi.mock("@/features/file-system/stores/file-system.store", () => ({
  useFileSystemStore: {
    getState: () => ({
      switchToProject: async (projectId: string) => {
        mocks.calls.push(`switch:${projectId}`);
        if (mocks.switchResult) mocks.activeProjectId = projectId;
        return mocks.switchResult;
      },
    }),
  },
}));
vi.mock("@/features/ai/services/open-agent-history", () => ({
  openAgentHistoryChat: (chatId: string) => {
    mocks.calls.push(`open:${chatId}@${mocks.activeProjectId}`);
    return `agent://${chatId}`;
  },
}));
vi.mock("@/features/ai/services/open-new-agent-chat", () => ({
  openNewAgentChat: () => {
    mocks.calls.push(`new@${mocks.activeProjectId}`);
    return "agent://new";
  },
}));
vi.mock("@/features/ai/stores/ai-chat.store", () => ({
  useAIChatStore: {
    getState: () => ({
      chats: mocks.chats,
      actions: {
        createNewChat: mocks.createNewChat,
        setPendingAgentLaunchRequest: mocks.setPendingAgentLaunchRequest,
      },
    }),
  },
}));
vi.mock("@/features/editor/stores/buffer.store", () => ({
  useBufferStore: {
    getState: () => ({
      actions: {
        openAgentBuffer: (chatId: string) => {
          mocks.calls.push(`tab:${chatId}@${mocks.activeProjectId}`);
          return `agent://${chatId}`;
        },
      },
    }),
  },
}));
vi.mock("@/features/layout/services/agents-sidebar-reveal", () => ({
  revealAgentsSidebar: () => mocks.calls.push("reveal"),
}));

import {
  launchAgentInProject,
  openAgentSession,
  startAgentInProject,
} from "@/features/ai/services/agent-project-navigation";

describe("agent project navigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.activeProjectId = "project-a";
    mocks.switchResult = true;
    mocks.calls = [];
  });

  it("opens a session of the active project right away", () => {
    expect(openAgentSession("chat-a")).toBe("agent://chat-a");
    expect(mocks.calls).toEqual(["open:chat-a@project-a"]);
  });

  it("switches to another project before opening its session", async () => {
    expect(await openAgentSession("chat-b")).toBe("agent://chat-b");
    expect(mocks.calls).toEqual(["switch:project-b", "open:chat-b@project-b"]);
  });

  it("opens nothing when the project switch fails", async () => {
    mocks.switchResult = false;
    expect(await openAgentSession("chat-b")).toBeNull();
    expect(mocks.calls).toEqual(["switch:project-b"]);
  });

  it("starts a new session in the project picked", async () => {
    await startAgentInProject("project-b");
    expect(mocks.calls).toEqual(["switch:project-b", "new@project-b"]);
  });

  it("creates a launched session in the target project and reveals the agents", async () => {
    const launch = {
      agentId: "claude-code" as const,
      prompt: "Work on issue #1",
      selectedBufferIds: [],
      selectedFilesPaths: [],
      editorSelections: [],
    };
    expect(await launchAgentInProject("project-b", launch)).toBe("new-chat");
    expect(mocks.calls).toEqual(["switch:project-b", "tab:new-chat@project-b", "reveal"]);
    expect(mocks.setPendingAgentLaunchRequest).toHaveBeenCalledWith({
      ...launch,
      chatId: "new-chat",
    });
  });

  it("stays in the active project for unknown or missing project ids", () => {
    startAgentInProject(null);
    startAgentInProject("closed-project");
    expect(mocks.calls).toEqual(["new@project-a", "new@project-a"]);
  });
});
