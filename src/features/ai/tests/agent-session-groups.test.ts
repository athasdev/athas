import { describe, expect, it } from "vite-plus/test";
import { formatAgentIdAsName } from "@/features/ai/hooks/use-agent-display-names";
import {
  groupAgentSessionsByActivity,
  isAgentSessionWorking,
} from "@/features/ai/lib/agent-session-groups";
import type { Chat } from "@/features/ai/types/ai-chat.types";

const now = new Date(2026, 9, 7, 15, 0);
const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3_600_000);
const chat = (id: string, lastMessageAt: Date): Chat =>
  ({
    id,
    title: id,
    agentId: "custom",
    messages: [],
    createdAt: lastMessageAt,
    lastMessageAt,
  }) as Chat;

describe("agent session groups", () => {
  it("splits sessions by last activity and keeps their order", () => {
    const groups = groupAgentSessionsByActivity(
      [
        chat("a", hoursAgo(1)),
        chat("b", hoursAgo(14)),
        chat("c", hoursAgo(20)),
        chat("d", hoursAgo(24 * 4)),
        chat("e", hoursAgo(24 * 20)),
        chat("f", hoursAgo(24 * 90)),
      ],
      now,
    );
    expect(groups.map((group) => [group.label, group.chats.map((c) => c.id)])).toEqual([
      ["Today", ["a", "b"]],
      ["Yesterday", ["c"]],
      ["Previous 7 days", ["d"]],
      ["Previous 30 days", ["e"]],
      ["Older", ["f"]],
    ]);
  });

  it("leaves out empty groups", () => {
    expect(groupAgentSessionsByActivity([chat("a", hoursAgo(24 * 90))], now)).toHaveLength(1);
  });

  it("treats a session as working while its last message streams", () => {
    expect(isAgentSessionWorking({ messages: [] })).toBe(false);
    expect(
      isAgentSessionWorking({
        messages: [
          { id: "m", role: "assistant", content: "", isStreaming: true },
        ] as Chat["messages"],
      }),
    ).toBe(true);
  });

  it("names agents readably before the catalog loads", () => {
    expect(formatAgentIdAsName("claude-code")).toBe("Claude Code");
    expect(formatAgentIdAsName("gemini")).toBe("Gemini");
  });
});
