import { describe, expect, test } from "bun:test";
import { getDefaultChatTitle } from "@/features/ai/lib/chat-scope";
import type { Chat } from "@/features/ai/types/ai-chat";
import {
  buildPiNativeRuntimeStateFromSession,
  derivePiNativeSessionTitle,
  shouldReconcilePiNativeSession,
} from "./pi-native-restore";

const createChat = (overrides: Partial<Chat> = {}): Chat => ({
  id: "harness:harness:1",
  title: getDefaultChatTitle("harness"),
  messages: [],
  createdAt: new Date("2026-03-27T10:00:00.000Z"),
  lastMessageAt: new Date("2026-03-27T10:00:00.000Z"),
  agentId: "pi",
  parentChatId: null,
  rootChatId: "harness:harness:1",
  branchPointMessageId: null,
  lineageDepth: 0,
  sessionName: null,
  acpState: null,
  acpActivity: null,
  ...overrides,
});

describe("pi-native restore", () => {
  test("reconciles an empty Harness Pi chat with no native session path yet", () => {
    expect(
      shouldReconcilePiNativeSession({
        surface: "harness",
        runtimeBackend: "pi-native",
        agentId: "pi",
        workspacePath: "/home/fsos/Developer/athas",
        chat: createChat(),
      }),
    ).toBe(true);
  });

  test("does not reconcile when the current chat already points at a native session path", () => {
    expect(
      shouldReconcilePiNativeSession({
        surface: "harness",
        runtimeBackend: "pi-native",
        agentId: "pi",
        workspacePath: "/home/fsos/Developer/athas",
        chat: createChat({
          acpState: {
            preferredModeId: null,
            currentModeId: null,
            availableModes: [],
            slashCommands: [],
            runtimeState: {
              agentId: "pi",
              source: "pi-native",
              sessionId: "native-session-123",
              sessionPath: "/tmp/session.jsonl",
              workspacePath: "/home/fsos/Developer/athas",
              provider: null,
              modelId: null,
              thinkingLevel: null,
              behavior: null,
            },
          },
        }),
      }),
    ).toBe(false);
  });

  test("does not reconcile when the chat already has messages", () => {
    expect(
      shouldReconcilePiNativeSession({
        surface: "harness",
        runtimeBackend: "pi-native",
        agentId: "pi",
        workspacePath: "/home/fsos/Developer/athas",
        chat: createChat({
          messages: [
            {
              id: "message-1",
              lineageMessageId: "message-1",
              content: "hello",
              role: "user",
              timestamp: new Date("2026-03-27T10:00:00.000Z"),
            },
          ],
        }),
      }),
    ).toBe(false);
  });

  test("prefers the native session name for the chat title", () => {
    expect(
      derivePiNativeSessionTitle({
        name: "Workspace Main",
        firstMessage: "ignored",
      }),
    ).toBe("Workspace Main");
  });

  test("falls back to a trimmed first message preview when the native session has no name", () => {
    expect(
      derivePiNativeSessionTitle({
        name: null,
        firstMessage:
          "   Reply with exactly READY and nothing else after checking the workspace state.   ",
      }),
    ).toBe("Reply with exactly READY and nothing else after chec...");
  });

  test("builds a pi-native runtime state from session info", () => {
    expect(
      buildPiNativeRuntimeStateFromSession({
        path: "/tmp/session.jsonl",
        id: "native-session-123",
        cwd: "/home/fsos/Developer/athas",
        name: "Workspace Main",
        parentSessionPath: null,
        createdAt: "2026-03-27T09:00:00.000Z",
        modifiedAt: "2026-03-27T09:30:00.000Z",
        messageCount: 4,
        firstMessage: "hello",
      }),
    ).toEqual({
      agentId: "pi",
      source: "pi-native",
      sessionId: "native-session-123",
      sessionPath: "/tmp/session.jsonl",
      workspacePath: "/home/fsos/Developer/athas",
      provider: null,
      modelId: null,
      thinkingLevel: null,
      behavior: null,
    });
  });
});
