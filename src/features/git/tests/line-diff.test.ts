import { describe, expect, it } from "vitest";
import {
  buildGitDiffLines,
  buildLineDiffHunks,
  diffTextLines,
  type LineDiffOp,
} from "../utils/line-diff";

function render(ops: LineDiffOp[]): string[] {
  return ops.map((op) => {
    const marker = op.type === "added" ? "+" : op.type === "removed" ? "-" : " ";
    return `${marker}${op.content}`;
  });
}

/** Replaying the ops must reproduce both sides exactly. */
function reconstruct(ops: LineDiffOp[]) {
  return {
    old: ops
      .filter((op) => op.type !== "added")
      .map((op) => op.content)
      .join("\n"),
    next: ops
      .filter((op) => op.type !== "removed")
      .map((op) => op.content)
      .join("\n"),
  };
}

describe("line diff", () => {
  it("touches only the changed line in an otherwise identical file", () => {
    const oldText = Array.from({ length: 600 }, (_, index) => `line ${index}`).join("\n");
    const newText = oldText.replace("line 300", "line 300 changed");

    const ops = diffTextLines(oldText, newText);

    expect(ops.filter((op) => op.type === "removed")).toEqual([
      { type: "removed", content: "line 300", oldLine: 301 },
    ]);
    expect(ops.filter((op) => op.type === "added")).toEqual([
      { type: "added", content: "line 300 changed", newLine: 301 },
    ]);
    expect(ops).toHaveLength(601);
  });

  it("reports an insertion without rewriting the surrounding lines", () => {
    const ops = diffTextLines("a\nb\nc", "a\nb\nb2\nc");

    expect(render(ops)).toEqual([" a", " b", "+b2", " c"]);
  });

  it("reports a deletion without rewriting the surrounding lines", () => {
    const ops = diffTextLines("a\nb\nc\nd", "a\nd");

    expect(render(ops)).toEqual([" a", "-b", "-c", " d"]);
  });

  it("treats a new file as pure additions and a deleted file as pure removals", () => {
    expect(render(diffTextLines("", "a\nb"))).toEqual(["+a", "+b"]);
    expect(render(diffTextLines("a\nb", ""))).toEqual(["-a", "-b"]);
  });

  it("emits nothing to review when the texts match", () => {
    const ops = diffTextLines("a\nb\nc", "a\nb\nc");

    expect(ops.every((op) => op.type === "context")).toBe(true);
    expect(buildLineDiffHunks(ops)).toEqual([]);
    expect(buildGitDiffLines("a\nb\nc", "a\nb\nc")).toEqual([]);
  });

  it("reconstructs both sides for an interleaved rewrite", () => {
    const oldText = "one\ntwo\nthree\nfour\nfive";
    const newText = "one\n2\nthree\nfour\n5\nsix";

    const { old, next } = reconstruct(diffTextLines(oldText, newText));

    expect(old).toBe(oldText);
    expect(next).toBe(newText);
  });

  it("falls back to a wholesale replacement when the texts are too dissimilar", () => {
    const oldText = Array.from({ length: 1400 }, (_, index) => `old ${index}`).join("\n");
    const newText = Array.from({ length: 1400 }, (_, index) => `new ${index}`).join("\n");

    const ops = diffTextLines(oldText, newText);
    const { old, next } = reconstruct(ops);

    expect(ops.some((op) => op.type === "context")).toBe(false);
    expect(old).toBe(oldText);
    expect(next).toBe(newText);
  });
});

describe("line diff hunks", () => {
  it("keeps three lines of context around a change", () => {
    const oldText = Array.from({ length: 40 }, (_, index) => `line ${index}`).join("\n");
    const newText = oldText.replace("line 20", "line 20 changed");

    const hunks = buildLineDiffHunks(diffTextLines(oldText, newText));

    expect(hunks).toHaveLength(1);
    expect(hunks[0].ops).toHaveLength(8);
    expect(hunks[0].oldStart).toBe(18);
    expect(hunks[0].oldCount).toBe(7);
    expect(hunks[0].newStart).toBe(18);
    expect(hunks[0].newCount).toBe(7);
  });

  it("splits distant changes into separate hunks and merges close ones", () => {
    const oldText = Array.from({ length: 60 }, (_, index) => `line ${index}`).join("\n");
    const distant = oldText.replace("line 10", "changed 10").replace("line 50", "changed 50");
    const close = oldText.replace("line 10", "changed 10").replace("line 12", "changed 12");

    expect(buildLineDiffHunks(diffTextLines(oldText, distant))).toHaveLength(2);
    expect(buildLineDiffHunks(diffTextLines(oldText, close))).toHaveLength(1);
  });

  it("renders git diff lines with a hunk header carrying real offsets", () => {
    const oldText = Array.from({ length: 40 }, (_, index) => `line ${index}`).join("\n");
    const newText = oldText.replace("line 20", "line 20 changed");

    const lines = buildGitDiffLines(oldText, newText);

    expect(lines[0]).toEqual({ line_type: "header", content: "@@ -18,7 +18,7 @@" });
    expect(lines.filter((line) => line.line_type === "added")).toHaveLength(1);
    expect(lines.filter((line) => line.line_type === "removed")).toHaveLength(1);
    expect(lines.filter((line) => line.line_type === "context")).toHaveLength(6);
  });
});
