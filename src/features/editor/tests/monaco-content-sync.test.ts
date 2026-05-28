import { describe, expect, it } from "vite-plus/test";
import { consumeLocalContentSnapshot, rememberLocalContentSnapshot } from "../monaco/content-sync";

describe("Monaco content sync", () => {
  it("recognizes stale local content echoes without applying them twice", () => {
    const snapshots: string[] = [];

    rememberLocalContentSnapshot(snapshots, "a");
    rememberLocalContentSnapshot(snapshots, "ab");

    expect(consumeLocalContentSnapshot(snapshots, "a")).toBe(true);
    expect(snapshots).toEqual(["ab"]);
    expect(consumeLocalContentSnapshot(snapshots, "ab")).toBe(true);
    expect(snapshots).toEqual([]);
  });

  it("keeps only recent local snapshots", () => {
    const snapshots: string[] = [];

    for (let index = 0; index < 10; index++) {
      rememberLocalContentSnapshot(snapshots, `content-${index}`);
    }

    expect(consumeLocalContentSnapshot(snapshots, "content-0")).toBe(false);
    expect(consumeLocalContentSnapshot(snapshots, "content-1")).toBe(false);
    expect(consumeLocalContentSnapshot(snapshots, "content-2")).toBe(true);
    expect(consumeLocalContentSnapshot(snapshots, "content-9")).toBe(true);
  });
});
