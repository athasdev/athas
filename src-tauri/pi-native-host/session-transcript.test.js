import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadSessionTranscript, parseSessionTranscript } from "./session-transcript.mjs";

describe("pi-native session transcript", () => {
  test("extracts visible transcript entries and runtime metadata from session entries", () => {
    const transcript = parseSessionTranscript([
      JSON.stringify({
        type: "session",
        id: "session-1",
      }),
      JSON.stringify({
        type: "model_change",
        id: "model-change-1",
        timestamp: "2026-03-27T08:59:00.000Z",
        provider: "openai-codex",
        modelId: "gpt-5.4",
      }),
      JSON.stringify({
        type: "thinking_level_change",
        id: "thinking-change-1",
        timestamp: "2026-03-27T08:59:30.000Z",
        thinkingLevel: "high",
      }),
      JSON.stringify({
        type: "message",
        id: "message-user",
        timestamp: "2026-03-27T09:00:00.000Z",
        message: {
          role: "user",
          content: [{ type: "text", text: "hello from pi" }],
        },
      }),
      JSON.stringify({
        type: "message",
        id: "message-assistant",
        timestamp: "2026-03-27T09:01:00.000Z",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "considering" },
            { type: "text", text: "READY" },
          ],
          provider: "openai-codex",
          model: "gpt-5.4",
        },
      }),
      JSON.stringify({
        type: "message",
        id: "message-thinking-only",
        timestamp: "2026-03-27T09:02:00.000Z",
        message: {
          role: "assistant",
          content: [{ type: "thinking", thinking: "hidden" }],
        },
      }),
      JSON.stringify({
        type: "custom_message",
        id: "hidden-policy",
        timestamp: "2026-03-27T09:02:30.000Z",
        customType: "policy",
        display: false,
        content: "hidden",
      }),
    ]);

    expect(transcript).toEqual([
      {
        id: "model-change-1",
        entryType: "model_change",
        role: null,
        content: null,
        timestamp: "2026-03-27T08:59:00.000Z",
        provider: "openai-codex",
        modelId: "gpt-5.4",
        thinkingLevel: null,
      },
      {
        id: "thinking-change-1",
        entryType: "thinking_level_change",
        role: null,
        content: null,
        timestamp: "2026-03-27T08:59:30.000Z",
        provider: null,
        modelId: null,
        thinkingLevel: "high",
      },
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
    ]);
  });

  test("loads transcript entries from a jsonl session file", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "athas-pi-native-transcript-"));
    const sessionPath = join(tempDir, "session.jsonl");
    await writeFile(
      sessionPath,
      [
        JSON.stringify({
          type: "message",
          id: "message-user",
          timestamp: "2026-03-27T09:00:00.000Z",
          message: {
            role: "user",
            content: [{ type: "text", text: "hydrate me" }],
          },
        }),
        JSON.stringify({
          type: "message",
          id: "message-assistant",
          timestamp: "2026-03-27T09:01:00.000Z",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "hydrated" }],
          },
        }),
      ].join("\n"),
    );

    await expect(loadSessionTranscript(sessionPath)).resolves.toEqual([
      {
        id: "message-user",
        entryType: "message",
        role: "user",
        content: "hydrate me",
        timestamp: "2026-03-27T09:00:00.000Z",
        provider: null,
        modelId: null,
        thinkingLevel: null,
      },
      {
        id: "message-assistant",
        entryType: "message",
        role: "assistant",
        content: "hydrated",
        timestamp: "2026-03-27T09:01:00.000Z",
        provider: null,
        modelId: null,
        thinkingLevel: null,
      },
    ]);
  });
});
