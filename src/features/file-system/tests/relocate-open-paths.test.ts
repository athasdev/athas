import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { PaneContent } from "@/features/panes/types/pane-content.types";

const mocks = vi.hoisted(() => ({
  buffers: [] as PaneContent[],
  updateBuffer: vi.fn(),
  relocateTreePath: vi.fn(),
}));

vi.mock("@/features/editor/stores/buffer.store", () => ({
  useBufferStore: {
    getStore: () => ({
      getState: () => ({
        buffers: mocks.buffers,
        actions: { updateBuffer: mocks.updateBuffer },
      }),
    }),
  },
}));
vi.mock("@/features/file-explorer/stores/file-explorer-tree.store", () => ({
  useFileTreeStore: {
    getStore: () => ({ getState: () => ({ actions: { relocatePath: mocks.relocateTreePath } }) }),
  },
}));

import { relocatePath } from "../controllers/file-tree-utils";
import { relocateOpenPaths } from "../services/relocate-open-paths";

function editor(id: string, path: string): PaneContent {
  return { id, type: "editor", path, name: path.split("/").pop() } as PaneContent;
}

describe("relocatePath", () => {
  it("rewrites the entry itself and paths under it only", () => {
    expect(relocatePath("/r/src", "/r/src", "/r/core")).toBe("/r/core");
    expect(relocatePath("/r/src/a/b.ts", "/r/src", "/r/core")).toBe("/r/core/a/b.ts");
    expect(relocatePath("/r/srcx/b.ts", "/r/src", "/r/core")).toBeNull();
    expect(relocatePath("/r/lib/b.ts", "/r/src", "/r/core")).toBeNull();
  });
});

describe("relocateOpenPaths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.buffers = [];
  });

  it("moves buffers inside a renamed directory and the explorer state with it", () => {
    mocks.buffers = [
      editor("a", "/r/src/a.ts"),
      editor("b", "/r/src/nested/b.ts"),
      editor("c", "/r/srcx/c.ts"),
      editor("d", "/r/lib/d.ts"),
    ];

    relocateOpenPaths("ws", "/r/src", "/r/core");

    expect(mocks.relocateTreePath).toHaveBeenCalledWith("/r/src", "/r/core");
    expect(
      mocks.updateBuffer.mock.calls.map(([buffer]) => [buffer.id, buffer.path, buffer.name]),
    ).toEqual([
      ["a", "/r/core/a.ts", "a.ts"],
      ["b", "/r/core/nested/b.ts", "b.ts"],
    ]);
  });

  it("renames the buffer of a renamed file", () => {
    mocks.buffers = [editor("a", "/r/src/a.ts")];

    relocateOpenPaths("ws", "/r/src/a.ts", "/r/src/renamed.ts");

    expect(mocks.updateBuffer).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: "a", path: "/r/src/renamed.ts", name: "renamed.ts" }),
    );
  });
});
