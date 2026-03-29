import { describe, expect, test } from "bun:test";
import { DEFAULT_HARNESS_SESSION_KEY } from "@/features/ai/lib/chat-scope";
import { DEFAULT_HARNESS_RUNTIME_BACKEND } from "@/features/ai/lib/harness-runtime-backend";
import {
  buildHarnessTransitionPromptMessage,
  createClosedBufferHistoryEntry,
  getMostRecentClosedHarnessSession,
} from "./harness-session-lifecycle";

describe("harness session lifecycle helpers", () => {
  test("creates closed history entries for files and Harness sessions", () => {
    expect(
      createClosedBufferHistoryEntry({
        path: "agent://session-123",
        name: "Harness Session",
        isPinned: true,
        isAgent: true,
        agentSessionId: "session-123",
        agentBackend: "pi-native",
        isVirtual: true,
        isDiff: false,
        isImage: false,
        isSQLite: false,
        isMarkdownPreview: false,
        isHtmlPreview: false,
        isCsvPreview: false,
        isExternalEditor: false,
        isWebViewer: false,
        isPullRequest: false,
        isPdf: false,
        isTerminal: false,
      }),
    ).toEqual({
      kind: "agent",
      sessionId: "session-123",
      backend: "pi-native",
      name: "Harness Session",
      isPinned: true,
    });

    expect(
      createClosedBufferHistoryEntry({
        path: "/workspace/demo/src/index.ts",
        name: "index.ts",
        isPinned: false,
        isAgent: false,
        agentSessionId: undefined,
        agentBackend: undefined,
        isVirtual: false,
        isDiff: false,
        isImage: false,
        isSQLite: false,
        isMarkdownPreview: false,
        isHtmlPreview: false,
        isCsvPreview: false,
        isExternalEditor: false,
        isWebViewer: false,
        isPullRequest: false,
        isPdf: false,
        isTerminal: false,
      }),
    ).toEqual({
      kind: "file",
      path: "/workspace/demo/src/index.ts",
      name: "index.ts",
      isPinned: false,
    });
  });

  test("uses the default Harness session key when an agent buffer has no explicit session id", () => {
    expect(
      createClosedBufferHistoryEntry({
        path: "agent://default",
        name: "Harness",
        isPinned: false,
        isAgent: true,
        agentSessionId: undefined,
        agentBackend: undefined,
        isVirtual: true,
        isDiff: false,
        isImage: false,
        isSQLite: false,
        isMarkdownPreview: false,
        isHtmlPreview: false,
        isCsvPreview: false,
        isExternalEditor: false,
        isWebViewer: false,
        isPullRequest: false,
        isPdf: false,
        isTerminal: false,
      }),
    ).toEqual({
      kind: "agent",
      sessionId: DEFAULT_HARNESS_SESSION_KEY,
      backend: DEFAULT_HARNESS_RUNTIME_BACKEND,
      name: "Harness",
      isPinned: false,
    });
  });

  test("finds the most recent closed Harness session in mixed history", () => {
    expect(
      getMostRecentClosedHarnessSession([
        {
          kind: "file",
          path: "/workspace/demo/README.md",
          name: "README.md",
          isPinned: false,
        },
        {
          kind: "agent",
          sessionId: "session-456",
          backend: DEFAULT_HARNESS_RUNTIME_BACKEND,
          name: "Review Session",
          isPinned: false,
        },
      ]),
    ).toEqual({
      kind: "agent",
      sessionId: "session-456",
      backend: DEFAULT_HARNESS_RUNTIME_BACKEND,
      name: "Review Session",
      isPinned: false,
    });
  });

  test("formats project transition prompts with collapsed overflow", () => {
    expect(
      buildHarnessTransitionPromptMessage("switching projects", [
        "One",
        "Two",
        "Three",
        "Four",
        "Five",
        "Six",
      ]),
    ).toContain("• 1 more session");
  });
});
