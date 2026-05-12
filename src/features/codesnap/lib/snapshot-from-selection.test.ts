import { describe, expect, test } from "vite-plus/test";
import { buildSnapshotFromSelection } from "./snapshot-from-selection";

const buf = (content: string, path: string | null = "/a/x.ts", language = "typescript") => ({
  content,
  path,
  language,
});
const sel = (sl: number, sc: number, el: number, ec: number) => ({
  start: { line: sl, column: sc },
  end: { line: el, column: ec },
});

describe("buildSnapshotFromSelection", () => {
  test("returns null when there is no buffer", () => {
    expect(buildSnapshotFromSelection(sel(0, 0, 0, 0), null)).toBeNull();
  });

  test("non-empty selection produces snapshot of the selected substring", () => {
    const b = buf("abc\ndef\nghi");
    const out = buildSnapshotFromSelection(sel(0, 1, 1, 2), b)!;
    expect(out.text).toBe("bc\nde");
    expect(out.startLine).toBe(1); // 1-based
    expect(out.endLine).toBe(2);
    expect(out.language).toBe("typescript");
    expect(out.bufferPath).toBe("/a/x.ts");
  });

  test("empty/zero-width selection falls back to the active line", () => {
    const b = buf("first\nSECOND\nthird");
    const out = buildSnapshotFromSelection(sel(1, 3, 1, 3), b)!;
    expect(out.text).toBe("SECOND");
    expect(out.startLine).toBe(2);
    expect(out.endLine).toBe(2);
  });

  test("null selection falls back to the active line at line 0", () => {
    const b = buf("abc\ndef");
    const out = buildSnapshotFromSelection(null, b)!;
    expect(out.text).toBe("abc");
    expect(out.startLine).toBe(1);
    expect(out.endLine).toBe(1);
  });

  test("untitled buffer (null path) preserves null in snapshot", () => {
    const out = buildSnapshotFromSelection(sel(0, 0, 0, 3), buf("abcd", null))!;
    expect(out.bufferPath).toBeNull();
  });
});

describe("buildSnapshotFromBuffer", () => {
  test("returns snapshot spanning the entire buffer", async () => {
    const { buildSnapshotFromBuffer } = await import("./snapshot-from-selection");
    const out = buildSnapshotFromBuffer(buf("a\nb\nc"))!;
    expect(out.text).toBe("a\nb\nc");
    expect(out.startLine).toBe(1);
    expect(out.endLine).toBe(3);
  });

  test("returns null for null buffer", async () => {
    const { buildSnapshotFromBuffer } = await import("./snapshot-from-selection");
    expect(buildSnapshotFromBuffer(null)).toBeNull();
  });
});
