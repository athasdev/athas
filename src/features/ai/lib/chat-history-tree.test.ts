import { describe, expect, test } from "bun:test";
import { buildChatHistoryTree } from "./chat-history-tree";

const createChat = (overrides: Partial<Parameters<typeof buildChatHistoryTree>[0][number]>) => ({
  id: crypto.randomUUID(),
  title: "Chat",
  messages: [],
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  lastMessageAt: new Date("2026-01-01T00:00:00.000Z"),
  agentId: "custom" as const,
  parentChatId: null,
  rootChatId: "root",
  branchPointMessageId: null,
  lineageDepth: 0,
  sessionName: null,
  ...overrides,
});

describe("chat history tree", () => {
  test("nests child chats beneath their parents", () => {
    const root = createChat({ id: "root", rootChatId: "root", title: "Root" });
    const child = createChat({
      id: "child",
      rootChatId: "root",
      parentChatId: "root",
      lineageDepth: 1,
      title: "Child",
      createdAt: new Date("2026-01-01T00:00:01.000Z"),
    });

    expect(buildChatHistoryTree([child, root], "", new Set())).toEqual([
      {
        chat: root,
        depth: 0,
        hasChildren: true,
        childCount: 1,
        descendantCount: 1,
        isCollapsed: false,
        isCurrent: false,
        isOnActivePath: false,
      },
      {
        chat: child,
        depth: 1,
        hasChildren: false,
        childCount: 0,
        descendantCount: 0,
        isCollapsed: false,
        isCurrent: false,
        isOnActivePath: false,
      },
    ]);
  });

  test("respects collapsed branches", () => {
    const root = createChat({ id: "root", rootChatId: "root", title: "Root" });
    const child = createChat({
      id: "child",
      rootChatId: "root",
      parentChatId: "root",
      lineageDepth: 1,
      title: "Child",
      createdAt: new Date("2026-01-01T00:00:01.000Z"),
    });

    expect(buildChatHistoryTree([root, child], "", new Set(["root"]))).toEqual([
      {
        chat: root,
        depth: 0,
        hasChildren: true,
        childCount: 1,
        descendantCount: 1,
        isCollapsed: true,
        isCurrent: false,
        isOnActivePath: false,
      },
    ]);
  });

  test("includes ancestors for search matches", () => {
    const root = createChat({ id: "root", rootChatId: "root", title: "Build harness" });
    const child = createChat({
      id: "child",
      rootChatId: "root",
      parentChatId: "root",
      lineageDepth: 1,
      title: "Overflow recovery",
      createdAt: new Date("2026-01-01T00:00:01.000Z"),
    });

    expect(
      buildChatHistoryTree([root, child], "overflow", new Set()).map((item) => item.chat.id),
    ).toEqual(["root", "child"]);
  });

  test("marks the active lineage path and current chat", () => {
    const root = createChat({ id: "root", rootChatId: "root", title: "Root" });
    const child = createChat({
      id: "child",
      rootChatId: "root",
      parentChatId: "root",
      lineageDepth: 1,
      title: "Child",
      createdAt: new Date("2026-01-01T00:00:01.000Z"),
    });

    expect(buildChatHistoryTree([root, child], "", new Set(), "child")).toEqual([
      {
        chat: root,
        depth: 0,
        hasChildren: true,
        childCount: 1,
        descendantCount: 1,
        isCollapsed: false,
        isCurrent: false,
        isOnActivePath: true,
      },
      {
        chat: child,
        depth: 1,
        hasChildren: false,
        childCount: 0,
        descendantCount: 0,
        isCollapsed: false,
        isCurrent: true,
        isOnActivePath: true,
      },
    ]);
  });
});
