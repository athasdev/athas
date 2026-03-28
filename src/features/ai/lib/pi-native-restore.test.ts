import { describe, expect, test } from "bun:test";
import { getDefaultChatTitle } from "@/features/ai/lib/chat-scope";
import type { Chat } from "@/features/ai/types/ai-chat";
import {
  buildPiNativeChatMessagesFromTranscript,
  buildPiNativeRuntimeStateFromSession,
  buildPiNativeSessionLineage,
  derivePiNativeSessionTitle,
  findOpenHarnessPiNativeSessionKey,
  findPiNativeParentChatForSession,
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
      buildPiNativeRuntimeStateFromSession(
        {
          path: "/tmp/session.jsonl",
          id: "native-session-123",
          cwd: "/home/fsos/Developer/athas",
          name: "Workspace Main",
          parentSessionPath: null,
          createdAt: "2026-03-27T09:00:00.000Z",
          modifiedAt: "2026-03-27T09:30:00.000Z",
          messageCount: 4,
          firstMessage: "hello",
        },
        [
          {
            id: "model-change-1",
            entryType: "model_change",
            role: null,
            content: null,
            timestamp: "2026-03-27T09:00:00.000Z",
            provider: "openai-codex",
            modelId: "gpt-5.4",
            thinkingLevel: null,
          },
          {
            id: "thinking-change-1",
            entryType: "thinking_level_change",
            role: null,
            content: null,
            timestamp: "2026-03-27T09:00:01.000Z",
            provider: null,
            modelId: null,
            thinkingLevel: "medium",
          },
          {
            id: "message-assistant",
            entryType: "message",
            role: "assistant",
            content: "READY",
            timestamp: "2026-03-27T09:01:00.000Z",
            provider: "openai-codex",
            modelId: "gpt-5.3-codex",
            thinkingLevel: null,
          },
        ],
      ),
    ).toEqual({
      agentId: "pi",
      source: "pi-native",
      sessionId: "native-session-123",
      sessionPath: "/tmp/session.jsonl",
      workspacePath: "/home/fsos/Developer/athas",
      provider: "openai-codex",
      modelId: "gpt-5.3-codex",
      thinkingLevel: "medium",
      behavior: null,
    });
  });

  test("builds Athas chat messages from a visible pi-native transcript", () => {
    expect(
      buildPiNativeChatMessagesFromTranscript([
        {
          id: "message-user",
          entryType: "message",
          role: "user",
          content: "hello from pi",
          timestamp: "2026-03-27T09:00:00.000Z",
          provider: null,
          modelId: null,
          thinkingLevel: null,
        },
        {
          id: "message-assistant",
          entryType: "message",
          role: "assistant",
          content: "READY",
          timestamp: "2026-03-27T09:01:00.000Z",
          provider: "openai-codex",
          modelId: "gpt-5.4",
          thinkingLevel: null,
        },
        {
          id: "thinking-change-1",
          entryType: "thinking_level_change",
          role: null,
          content: null,
          timestamp: "2026-03-27T09:01:30.000Z",
          provider: null,
          modelId: null,
          thinkingLevel: "high",
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

  test("finds an already-open Harness tab for the same pi-native session path", () => {
    expect(
      findOpenHarnessPiNativeSessionKey({
        sessionPath: "/tmp/session.jsonl",
        sessions: [
          {
            sessionKey: "harness",
            chat: createChat(),
          },
          {
            sessionKey: "forked",
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
                  provider: "openai-codex",
                  modelId: "gpt-5.3-codex",
                  thinkingLevel: "medium",
                  behavior: null,
                },
              },
            }),
          },
        ],
      }),
    ).toBe("forked");
  });

  test("ignores non-native or path-mismatched Harness sessions when opening recent pi-native sessions", () => {
    expect(
      findOpenHarnessPiNativeSessionKey({
        sessionPath: "/tmp/session.jsonl",
        sessions: [
          {
            sessionKey: "legacy",
            chat: createChat({
              acpState: {
                preferredModeId: null,
                currentModeId: null,
                availableModes: [],
                slashCommands: [],
                runtimeState: {
                  agentId: "pi",
                  source: "legacy-acp-bridge",
                  sessionId: "legacy-session-1",
                  sessionPath: "/tmp/session.jsonl",
                  workspacePath: "/home/fsos/Developer/athas",
                  provider: null,
                  modelId: null,
                  thinkingLevel: null,
                  behavior: null,
                },
              },
            }),
          },
          {
            sessionKey: "other-native",
            chat: createChat({
              acpState: {
                preferredModeId: null,
                currentModeId: null,
                availableModes: [],
                slashCommands: [],
                runtimeState: {
                  agentId: "pi",
                  source: "pi-native",
                  sessionId: "native-session-456",
                  sessionPath: "/tmp/other.jsonl",
                  workspacePath: "/home/fsos/Developer/athas",
                  provider: null,
                  modelId: null,
                  thinkingLevel: null,
                  behavior: null,
                },
              },
            }),
          },
        ],
      }),
    ).toBeNull();
  });

  test("finds the Athas parent chat for a pi-native child session by parent session path", () => {
    expect(
      findPiNativeParentChatForSession({
        session: {
          parentSessionPath: "/tmp/parent.jsonl",
        },
        chats: [
          createChat({
            id: "legacy-chat",
            acpState: {
              preferredModeId: null,
              currentModeId: null,
              availableModes: [],
              slashCommands: [],
              runtimeState: {
                agentId: "pi",
                source: "legacy-acp-bridge",
                sessionId: "legacy-session-1",
                sessionPath: "/tmp/parent.jsonl",
                workspacePath: "/home/fsos/Developer/athas",
                provider: null,
                modelId: null,
                thinkingLevel: null,
                behavior: null,
              },
            },
          }),
          createChat({
            id: "parent-chat",
            title: "Parent Session",
            rootChatId: "root-chat",
            lineageDepth: 1,
            sessionName: "Parent Session",
            acpState: {
              preferredModeId: null,
              currentModeId: null,
              availableModes: [],
              slashCommands: [],
              runtimeState: {
                agentId: "pi",
                source: "pi-native",
                sessionId: "native-session-parent",
                sessionPath: "/tmp/parent.jsonl",
                workspacePath: "/home/fsos/Developer/athas",
                provider: "openai-codex",
                modelId: "gpt-5.4",
                thinkingLevel: "medium",
                behavior: null,
              },
            },
          }),
        ],
      }),
    ).toMatchObject({
      id: "parent-chat",
      rootChatId: "root-chat",
      lineageDepth: 1,
    });
  });

  test("builds forked lineage for a pi-native session when its parent chat is known", () => {
    expect(
      buildPiNativeSessionLineage({
        sessionTitle: "Child Session",
        parentChat: {
          id: "parent-chat",
          title: "Parent Session",
          rootChatId: "root-chat",
          lineageDepth: 1,
          sessionName: "Parent Session",
        },
      }),
    ).toEqual({
      parentChatId: "parent-chat",
      rootChatId: "root-chat",
      branchPointMessageId: null,
      lineageDepth: 2,
      sessionName: "Child Session",
    });
  });
});
