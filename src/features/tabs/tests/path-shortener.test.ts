import { describe, expect, it } from "vite-plus/test";
import type { EditorContent } from "@/features/panes/types/pane-content.types";
import { calculateDisplayNames } from "../utils/path-shortener";

function makeEditorBuffer(id: string, path: string, isVirtual = false): EditorContent {
  return {
    id,
    type: "editor",
    path,
    name: path.split("/").pop() ?? path,
    content: "",
    savedContent: "",
    isDirty: false,
    isVirtual,
    isPinned: false,
    isPreview: false,
    isActive: false,
    language: "typescript",
    tokens: [],
  };
}

describe("calculateDisplayNames", () => {
  it("shows the bare filename when it is unique across buffers", () => {
    const names = calculateDisplayNames(
      [
        makeEditorBuffer("a", "/workspace/src/app.ts"),
        makeEditorBuffer("b", "/workspace/lib/util.ts"),
      ],
      "/workspace",
    );

    expect(names.get("a")).toBe("app.ts");
    expect(names.get("b")).toBe("util.ts");
  });

  it("disambiguates duplicate filenames with their parent directory", () => {
    const names = calculateDisplayNames(
      [
        makeEditorBuffer("a", "/workspace/client/index.ts"),
        makeEditorBuffer("b", "/workspace/server/index.ts"),
      ],
      "/workspace",
    );

    expect(names.get("a")).toBe("../client/index.ts");
    expect(names.get("b")).toBe("../server/index.ts");
  });

  it("walks further up the path until duplicates become distinct", () => {
    const names = calculateDisplayNames(
      [
        makeEditorBuffer("a", "/workspace/packages/web/src/index.ts"),
        makeEditorBuffer("b", "/workspace/packages/api/src/index.ts"),
        makeEditorBuffer("c", "/workspace/docs/src/index.ts"),
      ],
      "/workspace",
    );

    // One parent segment is not enough (two "src" folders), two are.
    expect(names.get("a")).toBe("../web/src/index.ts");
    expect(names.get("b")).toBe("../api/src/index.ts");
    expect(names.get("c")).toBe("../docs/src/index.ts");
  });

  it("falls back to the full relative path for identical paths", () => {
    const names = calculateDisplayNames(
      [
        makeEditorBuffer("a", "/workspace/dup/index.ts"),
        makeEditorBuffer("b", "/workspace/dup/index.ts"),
      ],
      "/workspace",
    );

    expect(names.get("a")).toBe("../workspace/dup/index.ts");
    expect(names.get("b")).toBe("../workspace/dup/index.ts");
  });

  it("uses the buffer name for virtual buffers", () => {
    const names = calculateDisplayNames(
      [makeEditorBuffer("term", "", true), makeEditorBuffer("file", "/workspace/a.ts")],
      "/workspace",
    );

    expect(names.has("term")).toBe(true);
    expect(names.get("file")).toBe("a.ts");
  });
});
