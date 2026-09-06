import { describe, expect, it } from "vite-plus/test";
import type { PaneContent } from "@/features/panes/types/pane-content.types";
import { getComposerAttachmentGroups } from "../utils/composer-attachment-groups";

function buffer(type: PaneContent["type"], id: string, path = `/project/${id}`): PaneContent {
  return {
    type,
    id,
    path,
    name: id,
    isPinned: false,
    isPreview: false,
    isActive: false,
  } as PaneContent;
}

function group(overrides: Partial<Parameters<typeof getComposerAttachmentGroups>[0]> = {}) {
  return getComposerAttachmentGroups({
    buffers: [],
    selectedBufferIds: new Set(),
    selectedFilesPaths: new Set(),
    selectedEditorContexts: [],
    pastedImages: [],
    ...overrides,
  });
}

describe("composer attachment groups", () => {
  it("summarizes five files and three diffs separately", () => {
    const diffs = [buffer("diff", "first"), buffer("diff", "second"), buffer("diff", "third")];
    expect(
      group({
        buffers: diffs,
        selectedBufferIds: new Set(diffs.map((item) => item.id)),
        selectedFilesPaths: new Set(["/a.ts", "/b.ts", "/c.ts", "/d.ts", "/e.ts"]),
      }).map((item) => item.label),
    ).toEqual(["5 files", "3 diffs"]);
  });

  it("counts a file selected from both an open tab and the project once while preserving both removal sources", () => {
    const groups = group({
      buffers: [buffer("editor", "tab", "/project/app.ts")],
      selectedBufferIds: new Set(["tab"]),
      selectedFilesPaths: new Set(["/project/app.ts"]),
    });
    expect(groups[0].label).toBe("1 file");
    expect(groups[0].items[0].sources).toEqual([
      { type: "buffer", id: "tab" },
      { type: "file", id: "/project/app.ts" },
    ]);
  });

  it("keeps a diff distinct from its attached source file", () => {
    const groups = group({
      buffers: [buffer("diff", "change", "/project/app.ts")],
      selectedBufferIds: new Set(["change"]),
      selectedFilesPaths: new Set(["/project/app.ts"]),
    });
    expect(groups.map((item) => item.label)).toEqual(["1 file", "1 diff"]);
  });

  it("groups pasted and referenced images together and keeps their removal sources", () => {
    const groups = group({
      selectedFilesPaths: new Set(["C:\\project\\photo.PNG"]),
      pastedImages: [
        { id: "paste", name: "Screenshot", dataUrl: "data:image/png;base64,aGVsbG8=", size: 5 },
      ],
    });
    expect(groups[0].label).toBe("2 images");
    expect(groups[0].items.map((item) => item.name)).toEqual(["photo.PNG", "Screenshot"]);
    expect(groups[0].items[1].sources).toEqual([{ type: "image", id: "paste" }]);
    expect(groups[0].items[1].preview).toBe("data:image/png;base64,aGVsbG8=");
  });

  it("uses resource types and ignores unavailable or unattachable tabs", () => {
    const buffers = [
      buffer("terminal", "terminal"),
      buffer("database", "db"),
      buffer("pullRequest", "pr"),
      buffer("agent", "agent"),
      buffer("newTab", "new"),
    ];
    expect(
      group({
        buffers,
        selectedBufferIds: new Set([...buffers.map((item) => item.id), "closed"]),
      }).map((item) => item.label),
    ).toEqual(["1 terminal", "1 database", "1 GitHub item"]);
    expect(group()).toEqual([]);
  });

  it("keeps distinct selections from the same file", () => {
    const selection = {
      id: "one",
      bufferId: "file",
      filePath: "/project/app.ts",
      fileName: "app.ts",
      languageId: "typescript",
      selectedText: "test",
      startLine: 1,
      startColumn: 1,
      endLine: 3,
      endColumn: 4,
    };
    const groups = group({
      selectedEditorContexts: [selection, { ...selection, id: "two", startLine: 5, endLine: 5 }],
    });
    expect(groups[0].label).toBe("2 selections");
    expect(groups[0].items.map((item) => item.name)).toEqual(["app.ts:1–3", "app.ts:5"]);
  });
});
