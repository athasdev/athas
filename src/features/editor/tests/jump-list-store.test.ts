import { beforeEach, describe, expect, it } from "vite-plus/test";
import { useJumpListStore } from "../stores/jump-list.store";

const actions = () => useJumpListStore.getState().actions;
const lines = () =>
  useJumpListStore.getState().entries.map((entry) => `${entry.filePath}:${entry.line}`);

function at(filePath: string, line: number) {
  return {
    bufferId: filePath,
    filePath,
    line,
    column: 0,
    offset: line * 10,
    scrollTop: 0,
    scrollLeft: 0,
  };
}

beforeEach(() => {
  actions().clear();
  useJumpListStore.setState({ maxEntries: 100 });
});

describe("jump list", () => {
  it("merges jumps to nearby lines of the same file", () => {
    actions().pushEntry(at("/a.ts", 10));
    actions().pushEntry(at("/a.ts", 14));
    actions().pushEntry(at("/a.ts", 40));
    actions().pushEntry(at("/b.ts", 40));

    expect(lines()).toEqual(["/a.ts:14", "/a.ts:40", "/b.ts:40"]);
  });

  it("goes back to where the user came from and forward again", () => {
    actions().pushEntry(at("/a.ts", 1));
    actions().pushEntry(at("/b.ts", 50));
    expect(actions().canGoBack()).toBe(true);
    expect(actions().canGoForward()).toBe(false);

    expect(actions().goBack(at("/c.ts", 99))?.filePath).toBe("/b.ts");
    expect(lines()).toEqual(["/a.ts:1", "/b.ts:50", "/c.ts:99"]);
    expect(actions().goBack()?.filePath).toBe("/a.ts");
    expect(actions().canGoBack()).toBe(false);
    expect(actions().goBack()).toBeNull();

    expect(actions().canGoForward()).toBe(true);
    expect(actions().goForward()?.filePath).toBe("/b.ts");
    expect(actions().goForward()?.filePath).toBe("/c.ts");
    expect(actions().goForward()).toBeNull();
  });

  it("drops the forward history when jumping somewhere new", () => {
    actions().pushEntry(at("/a.ts", 1));
    actions().pushEntry(at("/b.ts", 1));
    actions().pushEntry(at("/c.ts", 1));
    actions().goBack(at("/d.ts", 1));
    actions().goBack();

    actions().pushEntry(at("/e.ts", 1));

    expect(lines()).toEqual(["/a.ts:1", "/b.ts:1", "/e.ts:1"]);
    expect(actions().canGoForward()).toBe(false);
  });

  it("has nowhere to go with an empty or single-entry list", () => {
    expect(actions().canGoBack()).toBe(false);
    expect(actions().goBack(at("/a.ts", 1))).toBeNull();
    expect(actions().goForward()).toBeNull();

    actions().pushEntry(at("/a.ts", 1));
    expect(actions().goBack()).toBeNull();
  });

  it("keeps only the newest entries", () => {
    useJumpListStore.setState({ maxEntries: 3 });
    for (const file of ["/a", "/b", "/c", "/d"]) actions().pushEntry(at(file, 1));
    expect(lines()).toEqual(["/b:1", "/c:1", "/d:1"]);

    actions().goBack(at("/e", 1));
    expect(lines()).toEqual(["/c:1", "/d:1", "/e:1"]);
  });
});
