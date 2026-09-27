import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("@/features/ai/services/ai-chat-history-service", () => ({
  deleteChatFromDb: vi.fn(),
  initChatDatabase: vi.fn(),
  loadAllChatsFromDb: vi.fn(),
  loadChatFromDb: vi.fn(),
  saveChatMetadataToDb: vi.fn().mockResolvedValue(undefined),
  saveChatToDb: vi.fn().mockResolvedValue(undefined),
}));

import {
  filterComposerSlashCommands,
  mergeComposerSlashCommands,
  parseLeadingModeCommand,
  toSkillCommandName,
} from "@/features/ai/lib/composer-slash-commands";
import { compactChatMessages } from "@/features/ai/services/chat-compaction-service";
import type { Message } from "@/features/ai/types/ai-chat.types";

const skill = {
  id: "skill-1",
  title: "Write Release Notes",
  content: "Summarise the changes since the last tag.",
  createdAt: "",
  updatedAt: "",
};

describe("Composer slash commands", () => {
  it("offers Athas commands and skills to the built-in agent", () => {
    const names = mergeComposerSlashCommands({
      agentCommands: [],
      skills: [skill],
      isBuiltInAgent: true,
      availableModeIntents: ["agent", "ask", "plan"],
    }).map((command) => command.name);
    expect(names).toEqual([
      "agent",
      "ask",
      "plan",
      "compact",
      "review",
      "new",
      "clear",
      "write-release-notes",
    ]);
  });

  it("keeps an ACP agent's own command when the names collide and skips what it cannot do", () => {
    const commands = mergeComposerSlashCommands({
      agentCommands: [{ name: "review", description: "Review a pull request" }],
      skills: [],
      isBuiltInAgent: false,
      availableModeIntents: ["agent", "plan"],
    });
    expect(commands[0]).toMatchObject({ name: "review", source: "agent" });
    expect(commands.filter((command) => command.name === "review")).toHaveLength(1);
    expect(commands.map((command) => command.name)).not.toContain("ask");
    expect(commands.map((command) => command.name)).not.toContain("compact");
    expect(commands.map((command) => command.name)).not.toContain("clear");
  });

  it("ranks names that start with the query first", () => {
    const commands = mergeComposerSlashCommands({
      agentCommands: [],
      skills: [],
      isBuiltInAgent: true,
      availableModeIntents: ["agent", "ask", "plan"],
    });
    expect(filterComposerSlashCommands(commands, "c")[0]?.name).toBe("compact");
  });

  it("switches mode and sends the rest of a leading mode command", () => {
    const commands = mergeComposerSlashCommands({
      agentCommands: [],
      skills: [],
      isBuiltInAgent: true,
      availableModeIntents: ["agent", "ask", "plan"],
    });
    expect(parseLeadingModeCommand("/plan add dark mode", commands)).toEqual({
      intent: "plan",
      prompt: "add dark mode",
    });
    expect(parseLeadingModeCommand("/compact", commands)).toBeNull();
    expect(parseLeadingModeCommand("explain /plan", commands)).toBeNull();
  });

  it("names skill commands after their titles", () => {
    expect(toSkillCommandName("  Fix: flaky tests! ")).toBe("fix-flaky-tests");
  });
});

describe("Chat compaction", () => {
  const turn = (index: number, size: number): Message[] => [
    {
      id: `u${index}`,
      role: "user",
      content: `question ${index} ${"q".repeat(size)}`,
      timestamp: new Date(index),
    },
    {
      id: `a${index}`,
      role: "assistant",
      content: `answer ${index} ${"a".repeat(size)}`,
      timestamp: new Date(index),
    },
  ];

  it("summarises earlier turns and keeps the recent ones word for word", async () => {
    const messages = [...turn(1, 8_000), ...turn(2, 8_000), ...turn(3, 400)];
    const result = await compactChatMessages(messages);
    expect(result.compactedCount).toBe(4);
    expect(result.messages[0]).toMatchObject({ role: "user" });
    expect(result.messages[0].content).toContain("[Summary of 4 earlier messages");
    expect(result.messages.slice(1).map((message) => message.id)).toEqual(["u3", "a3"]);
  });

  it("keeps the last turn of a short chat and leaves an empty chat alone", async () => {
    const result = await compactChatMessages([...turn(1, 10), ...turn(2, 10)]);
    expect(result.compactedCount).toBe(2);
    expect(result.messages.slice(1).map((message) => message.id)).toEqual(["u2", "a2"]);
    expect((await compactChatMessages([])).compactedCount).toBe(0);
  });
});
