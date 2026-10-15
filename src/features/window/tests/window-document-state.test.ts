import { describe, expect, it } from "vitest";
import type { EditorContent } from "@/features/panes/types/pane-content.types";
import { getWindowDocumentState } from "@/features/window/utils/window-document-state";

const editorBuffer = (overrides: Partial<EditorContent> = {}): EditorContent => ({
  id: "editor-1",
  type: "editor",
  path: "/Users/me/project/src/main.ts",
  name: "main.ts",
  content: "",
  savedContent: "",
  isDirty: false,
  isVirtual: false,
  ...overrides,
});

describe("getWindowDocumentState", () => {
  it("uses active local document identity and project context", () => {
    expect(
      getWindowDocumentState({
        activeBuffer: editorBuffer({ isDirty: true }),
        projectName: "project",
        rootFolderPath: "/Users/me/project",
      }),
    ).toEqual({
      title: "main.ts — project — Athas",
      representedPath: "/Users/me/project/src/main.ts",
      isEdited: true,
    });
  });

  it("does not represent virtual or remote editors as local documents", () => {
    expect(
      getWindowDocumentState({
        activeBuffer: editorBuffer({ path: "remote://server/project/main.ts" }),
        projectName: "Remote Project",
        rootFolderPath: "remote://server/project",
      }),
    ).toEqual({
      title: "main.ts — Remote Project — Athas",
      representedPath: undefined,
      isEdited: false,
    });
  });

  it("uses project identity without an active tab", () => {
    expect(
      getWindowDocumentState({
        activeBuffer: null,
        projectName: "project",
        rootFolderPath: "/Users/me/project",
      }),
    ).toEqual({ title: "project — Athas", representedPath: undefined, isEdited: false });
  });
});
