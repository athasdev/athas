import { describe, expect, it } from "vite-plus/test";
import {
  getComposerBudgetTone,
  getComposerContextBudget,
  groupComposerBudget,
  resolveComposerContextWindow,
  shouldShowComposerContextMeter,
} from "@/features/ai/lib/composer-context-budget";
import type { Message } from "@/features/ai/types/ai-chat.types";
import type { PaneContent } from "@/features/panes/types/pane-content.types";

const editor = (id: string, content: string) =>
  ({
    id,
    type: "editor",
    path: `/project/${id}.ts`,
    name: `${id}.ts`,
    content,
  }) as unknown as PaneContent;

const message = (role: Message["role"], content: string): Message => ({
  id: `${role}-${content.length}`,
  role,
  content,
  timestamp: new Date(0),
});

describe("Composer context budget", () => {
  it("measures selected files, rules, history and references for the built-in agent", () => {
    const budget = getComposerContextBudget({
      providerId: "openai",
      modelContextWindow: 20_000,
      mode: "chat",
      messages: [message("user", "a".repeat(400)), message("assistant", "b".repeat(800))],
      buffers: [editor("one", "x".repeat(4_000)), editor("two", "y".repeat(4_000))],
      selectedBufferIds: new Set(["one"]),
      editorContexts: [
        {
          id: "sel",
          bufferId: "two",
          filePath: "/project/two.ts",
          fileName: "two.ts",
          languageId: "typescript",
          selectedText: "z".repeat(40),
          startLine: 1,
          startColumn: 1,
          endLine: 2,
          endColumn: 1,
        },
      ],
      rules: { text: "r".repeat(200), truncated: true },
    });

    const groups = groupComposerBudget(budget);
    expect(groups.map((group) => group.id)).toEqual([
      "files",
      "system",
      "history",
      "rules",
      "references",
    ]);
    expect(groups.find((group) => group.id === "files")?.tokens).toBe(1_000);
    expect(groups.find((group) => group.id === "history")?.tokens).toBe(300);
    expect(groups.find((group) => group.id === "rules")?.truncated).toBe(true);
    expect(budget.limitTokens).toBe(20_000 - 4_096);
    expect(getComposerBudgetTone(budget)).toBe("accent");
  });

  it("warns near the limit and flags going over it", () => {
    const base = {
      providerId: "openai",
      mode: "chat" as const,
      buffers: [editor("big", "x".repeat(40_000))],
      selectedBufferIds: new Set(["big"]),
      editorContexts: [],
      messages: [],
    };
    expect(
      getComposerBudgetTone(getComposerContextBudget({ ...base, modelContextWindow: 16_000 })),
    ).toBe("warning");
    const over = getComposerContextBudget({ ...base, modelContextWindow: 12_000 });
    expect(over.overLimit).toBe(true);
    expect(getComposerBudgetTone(over)).toBe("error");
  });

  it("measures hosted Athas requests against their request size cap", () => {
    expect(resolveComposerContextWindow("athas", undefined)).toEqual({
      contextWindowTokens: 100_000,
      reservedOutputTokens: 0,
    });
    expect(resolveComposerContextWindow("athas", 1_000_000)).toEqual({
      contextWindowTokens: 100_000,
      reservedOutputTokens: 0,
    });
    expect(resolveComposerContextWindow("ollama", undefined)).toEqual({});
  });

  it("uses a hosted model's own context window when it is smaller than the request cap", () => {
    expect(resolveComposerContextWindow("athas", 64_000)).toEqual({ contextWindowTokens: 64_000 });
  });

  it("stays hidden for a new chat that only carries the agent's instructions", () => {
    const base = {
      providerId: "openai",
      modelContextWindow: 128_000,
      mode: "chat" as const,
      buffers: [editor("app", "export const app = 1;")],
      editorContexts: [],
    };
    const empty = getComposerContextBudget({
      ...base,
      messages: [],
      selectedBufferIds: new Set<string>(),
    });
    expect(empty.usedTokens).toBeGreaterThan(0);
    expect(shouldShowComposerContextMeter(empty)).toBe(false);

    const withFile = getComposerContextBudget({
      ...base,
      messages: [],
      selectedBufferIds: new Set(["app"]),
    });
    expect(shouldShowComposerContextMeter(withFile)).toBe(true);

    const withHistory = getComposerContextBudget({
      ...base,
      messages: [message("user", "hello"), message("assistant", "hi")],
      selectedBufferIds: new Set<string>(),
    });
    expect(shouldShowComposerContextMeter(withHistory)).toBe(true);
  });
});
