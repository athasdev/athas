// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vite-plus/test";

vi.hoisted(() => {
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      invoke: vi.fn().mockResolvedValue(null),
      transformCallback: vi.fn(),
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    },
  });
});

vi.mock("@/features/ai/cloud-agents/hooks/use-cloud-sidebar-entries", () => ({
  useCloudSidebarEntries: (chats: { id: string }[]) => ({
    runsByProject: {},
    otherRuns: [],
    otherChats: chats.filter((chat) => chat.id === "cloud"),
  }),
}));
vi.mock("@/features/ai/services/ai-chat-history-service", () => ({
  deleteChatFromDb: vi.fn(),
  initChatDatabase: vi.fn(),
  loadAllChatsFromDb: vi.fn(),
  loadChatFromDb: vi.fn(),
  saveChatMetadataToDb: vi.fn().mockResolvedValue(undefined),
  saveChatToDb: vi.fn().mockResolvedValue(undefined),
}));

import { type SidebarSessions, useSidebarSessions } from "@/features/ai/hooks/use-sidebar-sessions";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import type { ChatSession } from "@/features/ai/types/ai-chat.types";
import { useWorkspaceTabsStore } from "@/features/workspace/stores/workspace-tabs.store";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const session = (
  id: string,
  minutesAgo: number,
  extra: Partial<ChatSession> = {},
): ChatSession => ({
  id,
  title: id,
  createdAt: new Date(Date.now() - (minutesAgo + 5) * 60_000),
  lastMessageAt: new Date(Date.now() - minutesAgo * 60_000),
  messageCount: 2,
  agentId: "claude-code",
  workspacePath: "/code/web",
  ...extra,
});

function readSidebarSessions() {
  const result = {} as { current: SidebarSessions };
  function Probe() {
    result.current = useSidebarSessions();
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(Probe)));
  act(() => root.unmount());
  return result.current;
}

describe("sidebar sessions", () => {
  it("moves pinned sessions out of their project into their own list", () => {
    useWorkspaceTabsStore.setState({
      projectTabs: [{ id: "web", name: "web", path: "/code/web", isActive: true, lastOpened: 1 }],
    });
    useAIChatStore.setState({
      currentChatId: null,
      chats: [
        session("recent", 1),
        session("pinned-old", 30, { isPinned: true }),
        session("pinned-new", 10, { isPinned: true }),
        session("cloud", 5, { isPinned: true, workspacePath: "/code/elsewhere" }),
        session("closed", 2, { isPinned: true, workspacePath: "/code/closed" }),
        session("archived", 3, { isPinned: true, archivedAt: new Date() }),
      ],
    });

    const sessions = readSidebarSessions();

    expect(sessions.pinned.map(({ id }) => id)).toEqual([
      "closed",
      "cloud",
      "pinned-new",
      "pinned-old",
    ]);
    expect(sessions.byProject.web.chats.map(({ id }) => id)).toEqual(["recent"]);
    expect(sessions.chats).toEqual([]);
    expect(sessions.otherChats).toEqual([]);
  });

  it("lists sessions of no project or of a closed project under Chats", () => {
    useWorkspaceTabsStore.setState({
      projectTabs: [{ id: "web", name: "web", path: "/code/web", isActive: true, lastOpened: 1 }],
    });
    useAIChatStore.setState({
      currentChatId: null,
      chats: [
        session("recent", 1),
        session("no-project", 4, { workspacePath: null }),
        session("closed", 2, { workspacePath: "/code/closed" }),
        session("cloud", 3, { workspacePath: "/code/elsewhere" }),
        session("empty", 5, {
          workspacePath: null,
          messageCount: 0,
          createdAt: new Date(Date.now() - 5 * 60_000),
        }),
        session("archived", 6, { workspacePath: null, archivedAt: new Date() }),
      ],
    });

    const sessions = readSidebarSessions();

    expect(sessions.byProject.web.chats.map(({ id }) => id)).toEqual(["recent"]);
    expect(sessions.chats.map(({ id }) => id)).toEqual(["closed", "no-project"]);
    expect(sessions.otherChats.map(({ id }) => id)).toEqual(["cloud"]);
  });
});
