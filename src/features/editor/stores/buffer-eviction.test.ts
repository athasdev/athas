import { describe, expect, it } from "vite-plus/test";
import type { PaneContent } from "@/features/panes/types/pane-content";
import { evictLeastRecentAutoClosableBuffer } from "./buffer-eviction";

const buffer = (
  id: string,
  type: PaneContent["type"] = "editor",
  overrides: Partial<PaneContent> = {},
): PaneContent =>
  ({
    id,
    type,
    path: id,
    name: id,
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

describe("buffer auto eviction", () => {
  it("evicts the oldest regular buffer when the auto-closable limit is reached", () => {
    const result = evictLeastRecentAutoClosableBuffer([buffer("old"), buffer("newer")], 2, {
      includePreviews: false,
    });

    expect(result.evictedBuffer?.id).toBe("old");
    expect(result.buffers.map((item) => item.id)).toEqual(["newer"]);
  });

  it("does not evict terminal-like stateful buffers", () => {
    const result = evictLeastRecentAutoClosableBuffer(
      [
        buffer("terminal", "terminal", { sessionId: "terminal-1" }),
        buffer("web", "webViewer", { url: "https://athas.dev" }),
        buffer("agent", "agent", { sessionId: "agent-1" }),
      ],
      1,
    );

    expect(result.evictedBuffer).toBeNull();
    expect(result.buffers.map((item) => item.id)).toEqual(["terminal", "web", "agent"]);
  });

  it("can ignore preview buffers for editor-file opens", () => {
    const result = evictLeastRecentAutoClosableBuffer(
      [buffer("preview", "editor", { isPreview: true }), buffer("regular")],
      1,
      { includePreviews: false },
    );

    expect(result.evictedBuffer?.id).toBe("regular");
    expect(result.buffers.map((item) => item.id)).toEqual(["preview"]);
  });
});
