import { describe, expect, test } from "bun:test";
import { getDefaultChatTitle } from "@/features/ai/lib/chat-scope";
import type { Chat } from "@/features/ai/types/ai-chat";
import {
  buildPiNativeChatMessagesFromTranscript,
  buildPiNativeRuntimeStateFromSession,
  derivePiNativeSessionTitle,
  shouldEnsurePiNativeRestoreChat,
  shouldReconcilePiNativeSession,
  shouldReuseCurrentHarnessSessionForPiNativeResume,
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
  test("ensures a blank Harness Pi chat exists before native restore when the workspace is open", () => {
    expect(
      shouldEnsurePiNativeRestoreChat({
        surface: "harness",
        runtimeBackend: "pi-native",
        agentId: "pi",
        workspacePath: "/home/fsos/Developer/athas",
        chat: null,
      }),
    ).toBe(true);
  });

  test("does not ensure a blank Harness Pi chat when the workspace path is missing", () => {
    expect(
      shouldEnsurePiNativeRestoreChat({
        surface: "harness",
        runtimeBackend: "pi-native",
        agentId: "pi",
        workspacePath: null,
        chat: null,
      }),
    ).toBe(false);
  });

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

  test("builds Athas chat messages from a visible pi-native transcript", () => {
    expect(
      buildPiNativeChatMessagesFromTranscript([
        {
          id: "message-user",
          role: "user",
          content: "hello from pi",
          timestamp: "2026-03-27T09:00:00.000Z",
        },
        {
          id: "message-assistant",
          role: "assistant",
          content: "READY",
          timestamp: "2026-03-27T09:01:00.000Z",
        },
      ]),
    ).toEqual([
      {
        id: "message-user",
        lineageMessageId: "message-user",
        content: "hello from pi",
        role: "user",
        timestamp: new Date("2026-03-27T09:00:00.000Z"),
        kind: "default",
      },
      {
        id: "message-assistant",
        lineageMessageId: "message-assistant",
        content: "READY",
        role: "assistant",
        timestamp: new Date("2026-03-27T09:01:00.000Z"),
        kind: "default",
      },
    ]);
  });

  test("reuses the current Harness session when it is still blank and has no native session path", () => {
    expect(
      shouldReuseCurrentHarnessSessionForPiNativeResume({
        sessionKey: "harness",
        chat: createChat(),
      }),
    ).toBe(true);
  });

  test("does not reuse the current Harness session when it already targets a native session", () => {
    expect(
      shouldReuseCurrentHarnessSessionForPiNativeResume({
        sessionKey: "harness",
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

  test("does not reuse the current Harness session when it already has conversation history", () => {
    expect(
      shouldReuseCurrentHarnessSessionForPiNativeResume({
        sessionKey: "harness",
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
});
