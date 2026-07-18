import { describe, expect, it } from "vite-plus/test";
import type { PaneContent } from "@/features/panes/types/pane-content.types";
import { getOpenBufferSearchSnapshot } from "../utils/open-buffer-search-snapshot";

const buffer = (id: string, overrides: Partial<PaneContent> = {}): PaneContent =>
  ({
    id,
    type: "editor",
    path: `/workspace/${id}.ts`,
    name: `${id}.ts`,
    isPinned: false,
    isPreview: false,
    isActive: false,
    content: "",
    savedContent: "",
    isDirty: false,
    isVirtual: false,
    tokens: [],
    ...overrides,
  }) as PaneContent;

describe("open buffer search snapshot", () => {
  it("tracks active buffer path and excludes virtual buffers from open paths", () => {
    const snapshot = getOpenBufferSearchSnapshot(
      [
        buffer("active"),
        buffer("open"),
        buffer("virtual", {
          path: "settings://user-settings.json",
          isVirtual: true,
        }),
      ],
      "active",
    );

    expect(snapshot.activeBufferPath).toBe("/workspace/active.ts");
    expect(snapshot.openBufferPaths.has("/workspace/open.ts")).toBe(true);
    expect(snapshot.openBufferPaths.has("settings://user-settings.json")).toBe(false);
  });

  it("reuses snapshots when only unrelated buffer content changes", () => {
    const firstBuffers = [buffer("active"), buffer("open", { content: "one" })];
    const firstSnapshot = getOpenBufferSearchSnapshot(firstBuffers, "active");
    const secondSnapshot = getOpenBufferSearchSnapshot(
      [buffer("active"), buffer("open", { content: "two" })],
      "active",
    );

    expect(secondSnapshot).toBe(firstSnapshot);
  });

  it("refreshes snapshots when active buffer changes", () => {
    const buffers = [buffer("first"), buffer("second")];
    const firstSnapshot = getOpenBufferSearchSnapshot(buffers, "first");
    const secondSnapshot = getOpenBufferSearchSnapshot(buffers, "second");

    expect(secondSnapshot).not.toBe(firstSnapshot);
    expect(secondSnapshot.activeBufferPath).toBe("/workspace/second.ts");
    expect(secondSnapshot.openBufferPaths.has("/workspace/first.ts")).toBe(true);
  });
});
