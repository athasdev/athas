import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadSessionTranscript, parseSessionTranscript } from "./session-transcript.mjs";

describe("pi-native session transcript", () => {
  test("extracts visible user and assistant text messages from session entries", () => {
    const transcript = parseSessionTranscript([
      JSON.stringify({
        type: "session",
        id: "session-1",
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
    ]);

    expect(transcript).toEqual([
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
        role: "user",
        content: "hydrate me",
        timestamp: "2026-03-27T09:00:00.000Z",
      },
      {
        id: "message-assistant",
        role: "assistant",
        content: "hydrated",
        timestamp: "2026-03-27T09:01:00.000Z",
      },
    ]);
  });
});
