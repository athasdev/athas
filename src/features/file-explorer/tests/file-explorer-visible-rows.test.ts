import { describe, expect, test } from "vite-plus/test";
import { getVisibleFileTreeRowKey } from "../hooks/use-file-explorer-visible-rows";
import { getFileTreeRowHeight } from "../lib/file-tree-row";

describe("getFileTreeRowHeight", () => {
  test("tracks the configured UI font size", () => {
    expect(getFileTreeRowHeight(10)).toBe(23.5);
    expect(getFileTreeRowHeight(15)).toBe(30.25);
    expect(getFileTreeRowHeight(24)).toBe(42.4);
  });
});

describe("getVisibleFileTreeRowKey", () => {
  test("uses paths instead of changing indexes as virtual row keys", () => {
    const rows = [
      { file: { name: "a.ts", path: "/root/a.ts", isDir: false }, depth: 0, isExpanded: false },
      { file: { name: "b.ts", path: "/root/b.ts", isDir: false }, depth: 0, isExpanded: false },
    ];

    expect(getVisibleFileTreeRowKey(rows, 0)).toBe("/root/a.ts");
    expect(getVisibleFileTreeRowKey(rows, 1)).toBe("/root/b.ts");
    expect(getVisibleFileTreeRowKey(rows, 2)).toBe(2);
  });
});
