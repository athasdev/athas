import { describe, expect, test } from "bun:test";
import { pickContinueRecentRuntimeSession } from "./harness-session-actions";

describe("pickContinueRecentRuntimeSession", () => {
  test("prefers the latest non-current runtime session", () => {
    expect(
      pickContinueRecentRuntimeSession([
        { path: "/sessions/current.jsonl", isCurrent: true },
        { path: "/sessions/previous.jsonl", isCurrent: false },
        { path: "/sessions/older.jsonl", isCurrent: false },
      ]),
    ).toEqual({
      path: "/sessions/previous.jsonl",
      isCurrent: false,
    });
  });

  test("returns null when every recent session is already current", () => {
    expect(
      pickContinueRecentRuntimeSession([{ path: "/sessions/current.jsonl", isCurrent: true }]),
    ).toBeNull();
  });
});
