import { describe, expect, mock, test } from "bun:test";
import {
  createNewHarnessSession,
  pickContinueRecentRuntimeSession,
} from "./harness-session-actions";

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

describe("createNewHarnessSession", () => {
  test("creates a new session with the preferred Pi backend", () => {
    const createAgentBuffer = mock(() => "buffer-1");

    const bufferId = createNewHarnessSession(createAgentBuffer, "legacy-acp-bridge");

    expect(bufferId).toBe("buffer-1");
    expect(createAgentBuffer).toHaveBeenCalledWith({
      backend: "legacy-acp-bridge",
    });
  });
});
