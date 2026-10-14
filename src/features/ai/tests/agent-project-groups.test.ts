import { describe, expect, it } from "vitest";
import {
  findAgentSessionProject,
  groupAgentSessionsByProject,
  selectProjectsWithRunningAgents,
} from "@/features/ai/lib/agent-project-groups";
import type { ChatSession } from "@/features/ai/types/ai-chat.types";

const projects = [
  { id: "client", path: "/work/client" },
  { id: "athas", path: "/work/athas" },
  { id: "browser", path: "/work/athas-browser" },
];

function chat(id: string, workspacePath: string | null): ChatSession {
  const now = new Date();
  return {
    id,
    title: id,
    messageCount: 1,
    createdAt: now,
    lastMessageAt: now,
    agentId: "claude-code",
    acpSessionId: null,
    workspacePath,
  } as ChatSession;
}

describe("agent project groups", () => {
  it("matches sessions to open projects by normalized path", () => {
    expect(findAgentSessionProject(chat("1", "/work/athas/"), projects)?.id).toBe("athas");
    expect(findAgentSessionProject(chat("2", "/work/closed"), projects)).toBeNull();
    expect(findAgentSessionProject(chat("3", null), projects)).toBeNull();
  });

  it("groups sessions under every open project in tab order, keeping session order", () => {
    const groups = groupAgentSessionsByProject(
      [
        chat("athas-new", "/work/athas"),
        chat("client-1", "/work/client"),
        chat("closed", "/work/closed"),
        chat("athas-old", "/work/athas"),
      ],
      projects,
    );

    expect(groups.map((group) => [group.project.id, group.chats.map((item) => item.id)])).toEqual([
      ["client", ["client-1"]],
      ["athas", ["athas-new", "athas-old"]],
      ["browser", []],
    ]);
  });

  it("lists the projects with an agent mid-turn", () => {
    const chats = [
      chat("a", "/work/athas"),
      chat("b", "/work/athas-browser"),
      chat("c", "/work/closed"),
    ];
    expect(selectProjectsWithRunningAgents(projects, chats, ["b", "c"])).toEqual(["browser"]);
    expect(selectProjectsWithRunningAgents(projects, chats, [])).toEqual([]);
  });
});
