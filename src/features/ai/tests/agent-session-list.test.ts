import { describe, expect, it } from "vite-plus/test";
import { hasAgentSessionActivity, selectAgentSessions } from "@/features/ai/lib/agent-session-list";
import type { Chat } from "@/features/ai/types/ai-chat.types";

function chat(overrides: Partial<Chat> & Pick<Chat, "id">): Chat {
  const createdAt = overrides.createdAt ?? new Date("2026-01-01T00:00:00Z");

  return {
    title: "New Session",
    messages: [],
    createdAt,
    lastMessageAt: createdAt,
    agentId: "custom",
    workspacePath: "/workspace",
    ...overrides,
  } as Chat;
}

const used = (id: string, minutes: number, rest: Partial<Chat> = {}) =>
  chat({
    id,
    lastMessageAt: new Date(`2026-01-01T00:${String(minutes).padStart(2, "0")}:00Z`),
    ...rest,
  });

describe("agent session activity", () => {
  it("treats a session that never received a message as empty", () => {
    const createdAt = new Date("2026-01-01T00:00:00Z");
    expect(hasAgentSessionActivity({ createdAt, lastMessageAt: createdAt })).toBe(false);
  });

  it("tolerates the millisecond skew of historical rows", () => {
    const createdAt = new Date("2026-01-01T00:00:00Z");
    expect(
      hasAgentSessionActivity({
        createdAt,
        lastMessageAt: new Date(createdAt.getTime() + 3),
      }),
    ).toBe(false);
  });

  it("counts loaded messages even when the timestamps match", () => {
    const createdAt = new Date("2026-01-01T00:00:00Z");
    expect(
      hasAgentSessionActivity({
        createdAt,
        lastMessageAt: createdAt,
        messages: [{ id: "m1" }] as Chat["messages"],
      }),
    ).toBe(true);
  });
});

describe("agent session list", () => {
  it("hides messageless sessions from every surface", () => {
    const sessions = selectAgentSessions([chat({ id: "empty" }), used("used", 5)], {
      workspacePath: "/workspace",
    });

    expect(sessions.map((session) => session.id)).toEqual(["used"]);
  });

  it("keeps the open session listed while it is still empty", () => {
    const sessions = selectAgentSessions([chat({ id: "empty" }), used("used", 5)], {
      workspacePath: "/workspace",
      keepIds: ["empty"],
    });

    expect(sessions.map((session) => session.id)).toEqual(["used", "empty"]);
  });

  it("orders pinned sessions first and the rest by recency", () => {
    const sessions = selectAgentSessions(
      [used("old", 1), used("pinned", 2, { isPinned: true }), used("new", 9)],
      { workspacePath: "/workspace" },
    );

    expect(sessions.map((session) => session.id)).toEqual(["pinned", "new", "old"]);
  });

  it("excludes archived sessions unless they are asked for", () => {
    const chats = [used("live", 5), used("filed", 6, { archivedAt: new Date() })];

    expect(
      selectAgentSessions(chats, { workspacePath: "/workspace" }).map((session) => session.id),
    ).toEqual(["live"]);
    expect(
      selectAgentSessions(chats, { workspacePath: "/workspace", includeArchived: "only" }).map(
        (session) => session.id,
      ),
    ).toEqual(["filed"]);
  });

  it("keeps empty sessions available to navigation fallbacks", () => {
    const chats = [chat({ id: "empty" })];

    expect(selectAgentSessions(chats, { workspacePath: "/workspace" })).toEqual([]);
    expect(
      selectAgentSessions(chats, { workspacePath: "/workspace", includeEmpty: true }).map(
        (session) => session.id,
      ),
    ).toEqual(["empty"]);
  });

  it("scopes sessions to the workspace", () => {
    const sessions = selectAgentSessions(
      [used("here", 5), used("elsewhere", 6, { workspacePath: "/other" })],
      { workspacePath: "/workspace" },
    );

    expect(sessions.map((session) => session.id)).toEqual(["here"]);
  });
});
