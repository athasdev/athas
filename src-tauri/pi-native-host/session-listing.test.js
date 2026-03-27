import { describe, expect, test } from "bun:test";
import { serializeSessionInfo, sortAndSerializeSessions } from "./session-listing.mjs";

describe("pi-native session listing", () => {
  test("serializes session info into the wire format Athas expects", () => {
    const created = new Date("2026-03-27T08:00:00.000Z");
    const modified = new Date("2026-03-27T09:00:00.000Z");

    expect(
      serializeSessionInfo({
        path: "/tmp/session.jsonl",
        id: "session-1",
        cwd: "/tmp/project",
        name: "Main Session",
        parentSessionPath: null,
        created,
        modified,
        messageCount: 12,
        firstMessage: "hello",
      }),
    ).toEqual({
      path: "/tmp/session.jsonl",
      id: "session-1",
      cwd: "/tmp/project",
      name: "Main Session",
      parentSessionPath: null,
      createdAt: "2026-03-27T08:00:00.000Z",
      modifiedAt: "2026-03-27T09:00:00.000Z",
      messageCount: 12,
      firstMessage: "hello",
    });
  });

  test("sorts most recently modified sessions first", () => {
    const sessions = sortAndSerializeSessions([
      {
        path: "/tmp/older.jsonl",
        id: "older",
        cwd: "/tmp/project",
        name: null,
        parentSessionPath: null,
        created: new Date("2026-03-27T06:00:00.000Z"),
        modified: new Date("2026-03-27T07:00:00.000Z"),
        messageCount: 2,
        firstMessage: "older",
      },
      {
        path: "/tmp/newer.jsonl",
        id: "newer",
        cwd: "/tmp/project",
        name: "Newer",
        parentSessionPath: "/tmp/parent.jsonl",
        created: new Date("2026-03-27T08:00:00.000Z"),
        modified: new Date("2026-03-27T09:00:00.000Z"),
        messageCount: 4,
        firstMessage: "newer",
      },
    ]);

    expect(sessions.map((session) => session.id)).toEqual(["newer", "older"]);
    expect(sessions[0]?.parentSessionPath).toBe("/tmp/parent.jsonl");
  });
});
