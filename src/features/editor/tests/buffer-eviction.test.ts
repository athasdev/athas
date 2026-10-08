import { describe, expect, it } from "vite-plus/test";
import type { PaneContent } from "@/features/panes/types/pane-content.types";
import { evictLeastRecentAutoClosableBuffer } from "../stores/buffer-eviction";

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
    content: "",
    savedContent: "",
    isDirty: false,
    isVirtual: false,
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
        buffer("agent", "agent", { sessionId: "agent-1" }),
      ],
      1,
    );

    expect(result.evictedBuffer).toBeNull();
    expect(result.buffers.map((item) => item.id)).toEqual(["terminal", "agent"]);
  });

  it("does not evict singleton tool buffers", () => {
    const result = evictLeastRecentAutoClosableBuffer(
      [
        buffer("search", "globalSearch"),
        buffer("diagnostics", "diagnostics"),
        buffer("references", "references"),
      ],
      1,
    );

    expect(result.evictedBuffer).toBeNull();
    expect(result.buffers.map((item) => item.id)).toEqual(["search", "diagnostics", "references"]);
  });

  it("can ignore preview buffers for editor-file opens", () => {
    const result = evictLeastRecentAutoClosableBuffer([buffer("preview"), buffer("regular")], 1, {
      includePreviews: false,
      previewBufferIds: new Set(["preview"]),
    });

    expect(result.evictedBuffer?.id).toBe("regular");
    expect(result.buffers.map((item) => item.id)).toEqual(["preview"]);
  });
});

it("preserves dirty editor and image drafts when opening another tab", () => {
  const image = buffer("image", "image", {
    imageDraft: {
      initialSrc: "disk",
      history: ["disk", "edit"],
      index: 1,
      savedSrc: "disk",
      revision: 1,
      processing: 0,
      error: null,
    },
  });
  const result = evictLeastRecentAutoClosableBuffer(
    [buffer("dirty", "editor", { isDirty: true }), image, buffer("clean")],
    1,
  );
  expect(result.evictedBuffer?.id).toBe("clean");
  expect(result.buffers.map((item) => item.id)).toEqual(["dirty", "image"]);
});
