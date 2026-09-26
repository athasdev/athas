import { describe, expect, it } from "vite-plus/test";
import {
  buildHunkPreviewLines,
  computeAgentHunks,
  countChangedLines,
  keepHunk,
  rebaseOnDisk,
  recordAgentWrite,
  rejectHunk,
  transferLineEdits,
} from "@/features/ai/lib/agent-edit-hunks";
import type { AgentEditEntry } from "@/features/ai/types/agent-edits.types";

const lines = (...values: string[]) => values.join("\n");

function entry(baseline: string, current: string, created = false): AgentEditEntry {
  return { path: "/repo/a.ts", baseline, current, created, revision: 1 };
}

describe("computeAgentHunks", () => {
  it("splits separated changes into hunks without context", () => {
    const base = lines("a", "b", "c", "d", "e");
    const current = lines("a", "B", "c", "d", "e", "f");

    expect(computeAgentHunks(base, current)).toEqual([
      { baseStart: 1, baseLines: ["b"], currentStart: 1, currentLines: ["B"] },
      { baseStart: 5, baseLines: [], currentStart: 5, currentLines: ["f"] },
    ]);
  });

  it("reports nothing for equal texts and a single hunk for a new file", () => {
    expect(computeAgentHunks("same", "same")).toEqual([]);
    expect(computeAgentHunks("", lines("x", "y"))).toEqual([
      { baseStart: 0, baseLines: [], currentStart: 0, currentLines: ["x", "y"] },
    ]);
  });

  it("counts added and removed lines", () => {
    const hunks = computeAgentHunks(lines("a", "b"), lines("A", "b", "c"));
    expect(countChangedLines(hunks)).toEqual({ added: 2, removed: 1 });
  });
});

describe("keep and reject", () => {
  const base = lines("one", "two", "three", "four", "five");
  const current = lines("one", "TWO", "three", "four", "FIVE", "six");

  it("keeping a hunk moves it into the baseline and leaves the rest", () => {
    const log = entry(base, current);
    const [first] = computeAgentHunks(base, current);
    const baseline = keepHunk(log, first);

    expect(baseline).toBe(lines("one", "TWO", "three", "four", "five"));
    expect(computeAgentHunks(baseline ?? "", current)).toHaveLength(1);
  });

  it("rejecting a hunk puts the baseline lines back in the file", () => {
    const log = entry(base, current);
    const [, second] = computeAgentHunks(base, current);
    const reverted = rejectHunk(log, second);

    expect(reverted).toBe(lines("one", "TWO", "three", "four", "five"));
    expect(computeAgentHunks(base, reverted ?? "")).toHaveLength(1);
  });

  it("rejecting every hunk restores the file exactly", () => {
    let log = entry(base, current);
    for (let hunks = computeAgentHunks(log.baseline, log.current); hunks.length > 0;) {
      log = { ...log, current: rejectHunk(log, hunks[hunks.length - 1]) ?? "" };
      hunks = computeAgentHunks(log.baseline, log.current);
    }
    expect(log.current).toBe(base);
  });

  it("rejecting a created file's only hunk empties it", () => {
    const log = entry("", lines("new", "file", ""), true);
    const [hunk] = computeAgentHunks(log.baseline, log.current);
    expect(rejectHunk(log, hunk)).toBe("");
  });

  it("refuses a stale hunk", () => {
    const [hunk] = computeAgentHunks(base, current);
    const moved = entry(base, lines("zero", "one", "TWO", "three"));
    expect(rejectHunk(moved, hunk)).toBeNull();
    expect(keepHunk(entry(lines("x"), current), hunk)).toBeNull();
  });
});

describe("transferLineEdits", () => {
  const from = lines("a", "b", "c", "d", "e", "f");

  it("shifts an edit past changes above it", () => {
    const to = lines("new", "a", "b", "c", "d", "e", "f");
    const edit = { start: 4, deleteCount: 1, lines: ["E"] };
    expect(transferLineEdits(from, to, [edit])).toBe(lines("new", "a", "b", "c", "d", "E", "f"));
  });

  it("refuses an edit that touches changed lines", () => {
    const to = lines("a", "b", "C", "d", "e", "f");
    expect(transferLineEdits(from, to, [{ start: 2, deleteCount: 1, lines: ["x"] }])).toBeNull();
    // An insertion right at a changed line is ambiguous too.
    expect(transferLineEdits(from, to, [{ start: 3, deleteCount: 0, lines: ["x"] }])).toBeNull();
  });

  it("lets replacements that only meet at a boundary through", () => {
    const to = lines("a", "b", "C", "d", "e", "f");
    expect(transferLineEdits(from, to, [{ start: 3, deleteCount: 1, lines: ["D"] }])).toBe(
      lines("a", "b", "C", "D", "e", "f"),
    );
  });
});

describe("recordAgentWrite", () => {
  const write = (previousContent: string | null, content: string) => ({
    path: "/repo/a.ts",
    previousContent,
    content,
  });

  it("starts from the text the first write replaced", () => {
    const { entry: first } = recordAgentWrite(undefined, write("a\nb", "a\nB"));
    expect(first).toMatchObject({ baseline: "a\nb", current: "a\nB", created: false });
  });

  it("marks files the agent created", () => {
    const { entry: created } = recordAgentWrite(undefined, write(null, "hello"));
    expect(created).toMatchObject({ baseline: "", current: "hello", created: true });
  });

  it("accumulates later writes against the same baseline", () => {
    const first = recordAgentWrite(undefined, write(lines("a", "b", "c"), lines("A", "b", "c")));
    const second = recordAgentWrite(
      first.entry ?? undefined,
      write(lines("A", "b", "c"), lines("A", "b", "C")),
    );

    expect(second.lostEarlierReview).toBe(false);
    expect(second.entry?.baseline).toBe(lines("a", "b", "c"));
    expect(second.entry?.current).toBe(lines("A", "b", "C"));
    expect(second.entry?.revision).toBeGreaterThan(first.entry?.revision ?? 0);
    expect(
      computeAgentHunks(second.entry?.baseline ?? "", second.entry?.current ?? ""),
    ).toHaveLength(2);
  });

  it("drops the entry when the agent writes the baseline back", () => {
    const first = recordAgentWrite(undefined, write("a", "b"));
    expect(recordAgentWrite(first.entry ?? undefined, write("b", "a")).entry).toBeNull();
  });

  it("rebases a change made between two writes away from the agent's lines", () => {
    const first = recordAgentWrite(
      undefined,
      write(lines("a", "b", "c", "d", "e"), lines("A", "b", "c", "d", "e")),
    );
    // The user changed the last line before the agent wrote again.
    const second = recordAgentWrite(
      first.entry ?? undefined,
      write(lines("A", "b", "c", "d", "E"), lines("A", "b", "c", "d", "E", "f")),
    );

    expect(second.lostEarlierReview).toBe(false);
    expect(second.entry?.baseline).toBe(lines("a", "b", "c", "d", "E"));
  });

  it("starts over when a change between writes touched the agent's lines", () => {
    const first = recordAgentWrite(undefined, write(lines("a", "b"), lines("A", "b")));
    const second = recordAgentWrite(
      first.entry ?? undefined,
      write(lines("X", "b"), lines("X", "b", "c")),
    );

    expect(second.lostEarlierReview).toBe(true);
    expect(second.entry).toMatchObject({
      baseline: lines("X", "b"),
      current: lines("X", "b", "c"),
    });
  });
});

describe("rebaseOnDisk", () => {
  const log = entry(lines("a", "b", "c", "d", "e"), lines("a", "B", "c", "d", "e"));

  it("keeps the entry when the disk holds what the agent wrote", () => {
    expect(rebaseOnDisk(log, log.current)).toBe(log);
  });

  it("moves an external edit away from agent hunks into the baseline", () => {
    const rebased = rebaseOnDisk(log, lines("a", "B", "c", "d", "e", "user"));
    expect(rebased?.baseline).toBe(lines("a", "b", "c", "d", "e", "user"));
    expect(rebased?.current).toBe(lines("a", "B", "c", "d", "e", "user"));
    expect(computeAgentHunks(rebased?.baseline ?? "", rebased?.current ?? "")).toEqual([
      { baseStart: 1, baseLines: ["b"], currentStart: 1, currentLines: ["B"] },
    ]);
  });

  it("gives up on an external edit that touches an agent hunk", () => {
    expect(rebaseOnDisk(log, lines("a", "BB", "c", "d", "e"))).toBeNull();
  });
});

describe("buildHunkPreviewLines", () => {
  it("shows the hunk with numbered context on both sides", () => {
    const base = lines("a", "b", "c", "d", "e", "f");
    const current = lines("a", "b", "x", "y", "d", "e", "f");
    const [hunk] = computeAgentHunks(base, current);

    expect(buildHunkPreviewLines(current, hunk, 1)).toEqual([
      { type: "context", content: "b", oldLine: 2, newLine: 2 },
      { type: "removed", content: "c", oldLine: 3 },
      { type: "added", content: "x", newLine: 3 },
      { type: "added", content: "y", newLine: 4 },
      { type: "context", content: "d", oldLine: 4, newLine: 5 },
    ]);
  });
});
