import { describe, expect, it } from "vite-plus/test";
import {
  EMPTY_CHAT_CHECKPOINTS,
  dropRestoredCheckpoints,
  isCheckpointAvailable,
  parseChatCheckpoints,
  planCheckpointRestore,
  recordCheckpointWrite,
  summarizeCheckpoints,
  trimCheckpoints,
} from "@/features/ai/lib/agent-edit-checkpoints";
import type { ChatCheckpoints } from "@/features/ai/types/agent-checkpoints.types";

function write(
  state: ChatCheckpoints,
  messageId: string,
  path: string,
  previousContent: string | null,
  content: string | null,
  now = 1,
) {
  return recordCheckpointWrite(state, messageId, { path, previousContent, content }, now);
}

describe("agent edit checkpoints", () => {
  it("keeps the text before a turn's first write and after its last", () => {
    let state = write(EMPTY_CHAT_CHECKPOINTS, "m1", "/a", "a0", "a1");
    state = write(state, "m1", "/a", "a1", "a2");
    state = write(state, "m1", "/b", null, "b1");

    expect(state.checkpoints).toHaveLength(1);
    expect(state.checkpoints[0].files["/a"]).toEqual({ path: "/a", before: "a0", after: "a2" });
    expect(summarizeCheckpoints(state)[0].files).toEqual([
      { path: "/a", created: false, deleted: false },
      { path: "/b", created: true, deleted: false },
    ]);
  });

  it("restores every file changed from a turn on to before that turn", () => {
    let state = write(EMPTY_CHAT_CHECKPOINTS, "m1", "/a", "a0", "a1");
    state = write(state, "m3", "/a", "a1", "a2");
    state = write(state, "m3", "/new", null, "n1");
    state = write(state, "m5", "/b", "b0", null);
    const order = ["m1", "r1", "m3", "r3", "m4", "m5"];

    expect(planCheckpointRestore(state, "m3", order)).toEqual({
      messageIds: ["m3", "m5"],
      files: [
        { path: "/a", target: "a1", expected: "a2" },
        { path: "/b", target: "b0", expected: null },
        { path: "/new", target: null, expected: "n1" },
      ],
    });
    // A turn that wrote nothing still undoes the turns after it.
    expect(planCheckpointRestore(state, "m4", order)?.messageIds).toEqual(["m5"]);
    expect(planCheckpointRestore(state, "m1", order)?.files[0]).toEqual({
      path: "/a",
      target: "a0",
      expected: "a2",
    });
    expect(planCheckpointRestore(state, "later", [...order, "later"])).toBeNull();
  });

  it("skips files a turn left as they were", () => {
    let state = write(EMPTY_CHAT_CHECKPOINTS, "m1", "/a", "a0", "a1");
    state = write(state, "m1", "/a", "a1", "a0");
    expect(planCheckpointRestore(state, "m1", ["m1"])).toBeNull();
  });

  it("drops the oldest turns past the budget and remembers where history stops", () => {
    let state = EMPTY_CHAT_CHECKPOINTS;
    for (let index = 0; index < 4; index++) {
      state = write(state, `m${index}`, "/a", `v${index}`, `v${index + 1}`, index + 10);
    }
    const trimmed = trimCheckpoints(state, 2, Number.POSITIVE_INFINITY);
    expect(trimmed.checkpoints.map((checkpoint) => checkpoint.messageId)).toEqual(["m2", "m3"]);
    expect(trimmed.truncatedAt).toBe(11);
    expect(isCheckpointAvailable(trimmed, 11)).toBe(false);
    expect(isCheckpointAvailable(trimmed, 12)).toBe(true);

    const huge = trimCheckpoints(state, 10, 1);
    expect(huge.checkpoints.map((checkpoint) => checkpoint.messageId)).toEqual(["m3"]);
  });

  it("forgets restored turns and round-trips through storage", () => {
    let state = write(EMPTY_CHAT_CHECKPOINTS, "m1", "/a", "a0", "a1");
    state = write(state, "m2", "/a", "a1", "a2");
    const kept = dropRestoredCheckpoints(state, ["m2"]);
    expect(kept.checkpoints.map((checkpoint) => checkpoint.messageId)).toEqual(["m1"]);

    expect(parseChatCheckpoints(JSON.stringify(state))).toEqual(state);
    expect(parseChatCheckpoints("not json")).toEqual(EMPTY_CHAT_CHECKPOINTS);
    expect(
      parseChatCheckpoints(JSON.stringify({ checkpoints: [{ messageId: 1 }], truncatedAt: "x" })),
    ).toEqual(EMPTY_CHAT_CHECKPOINTS);
  });
});
