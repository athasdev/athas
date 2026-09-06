import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { EditorContent } from "@/features/panes/types/pane-content.types";

const mocks = vi.hoisted(() => ({
  buffers: [] as EditorContent[],
  activeBufferId: "source",
  read: vi.fn(),
  readJava: vi.fn(),
  pushEntry: vi.fn(),
  requestNavigation: vi.fn(),
  openBuffer: vi.fn(),
  openContent: vi.fn(),
  setActiveBuffer: vi.fn(),
  convertPreviewToDefinite: vi.fn(),
}));
vi.mock("@/features/file-system/controllers/file-operations", () => ({
  readFileContent: mocks.read,
}));
vi.mock("../lsp/lsp-client", () => ({
  LspClient: { getInstance: () => ({ getJavaClassFileContents: mocks.readJava }) },
}));
vi.mock("../stores/buffer.store", () => ({
  useBufferStore: {
    getState: () => ({
      buffers: mocks.buffers,
      activeBufferId: mocks.activeBufferId,
      actions: {
        openBuffer: mocks.openBuffer,
        openContent: mocks.openContent,
        setActiveBuffer: mocks.setActiveBuffer,
        convertPreviewToDefinite: mocks.convertPreviewToDefinite,
      },
    }),
  },
}));
vi.mock("../stores/state.store", () => ({
  useEditorStateStore: {
    getState: () => ({
      cursorPosition: { line: 2, column: 3, offset: 20 },
      scrollTop: 90,
      scrollLeft: 0,
      actions: { requestNavigation: mocks.requestNavigation },
    }),
  },
}));
vi.mock("../stores/jump-list.store", () => ({
  useJumpListStore: { getState: () => ({ actions: { pushEntry: mocks.pushEntry } }) },
}));

import { navigateToLspLocation } from "../lsp/location-navigation";

function buffer(id: string, path: string, content = "first\nconst target = 1;") {
  return { id, type: "editor", path, content, isPreview: false } as EditorContent;
}
const target = {
  uri: "file:///project/target.ts",
  range: { start: { line: 1, character: 6 }, end: { line: 1, character: 12 } },
};

describe("editor location navigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.activeBufferId = "source";
    mocks.buffers = [buffer("source", "/project/source.ts")];
    mocks.read.mockResolvedValue("first\nconst target = 1;");
    mocks.readJava.mockResolvedValue("class String {}");
    mocks.openBuffer.mockImplementation((path, name, content) => {
      mocks.buffers.push(buffer(path, path, content));
      return path;
    });
    mocks.openContent.mockImplementation((input) => {
      mocks.buffers.push({ ...buffer(input.path, input.path), ...input });
      return input.path;
    });
    mocks.setActiveBuffer.mockImplementation((id) => {
      mocks.activeBufferId = id;
    });
  });

  it("opens files outside the model cache and queues the exact target until the editor mounts", async () => {
    await navigateToLspLocation(target);
    expect(mocks.read).toHaveBeenCalledWith("/project/target.ts");
    expect(mocks.setActiveBuffer).toHaveBeenCalledWith("/project/target.ts");
    expect(mocks.requestNavigation).toHaveBeenLastCalledWith({
      bufferId: "/project/target.ts",
      range: {
        start: { line: 1, column: 6, offset: 12 },
        end: { line: 1, column: 12, offset: 18 },
      },
    });
    expect(mocks.pushEntry).toHaveBeenCalledWith({
      bufferId: "source",
      filePath: "/project/source.ts",
      line: 2,
      column: 3,
      offset: 20,
      scrollTop: 90,
      scrollLeft: 0,
    });
  });

  it("reuses dirty buffers and promotes previews without rereading disk", async () => {
    mocks.buffers.push({
      ...buffer("target", "/project/target.ts", "unsaved\nconst target = 2;"),
      isPreview: true,
    });
    await navigateToLspLocation(target);
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.openBuffer).not.toHaveBeenCalled();
    expect(mocks.convertPreviewToDefinite).toHaveBeenCalledWith("target");
    expect(mocks.requestNavigation.mock.lastCall?.[0].range.start.offset).toBe(14);
  });

  it("opens Java library definitions as read-only virtual content", async () => {
    await navigateToLspLocation({ ...target, uri: "jdt://contents/java.lang/String.class?handle" });
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.readJava).toHaveBeenCalledWith(
      "/project/source.ts",
      "jdt://contents/java.lang/String.class?handle",
    );
    expect(mocks.openContent).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "String.class",
        readOnly: true,
        isVirtual: true,
        language: "java",
      }),
    );
  });

  it("does not activate a stale definition after a newer navigation wins", async () => {
    let resolveFirst: (content: string) => void = () => {};
    mocks.read.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          resolveFirst = resolve;
        }),
    );
    const first = navigateToLspLocation(target);
    await navigateToLspLocation({ ...target, uri: "file:///project/newer.ts" });
    resolveFirst("old response");
    await first;
    expect(mocks.openBuffer).toHaveBeenCalledTimes(1);
    expect(mocks.activeBufferId).toBe("/project/newer.ts");
  });

  it("does not steal focus if the user switches tabs during a file read", async () => {
    mocks.read.mockImplementationOnce(async () => {
      mocks.activeBufferId = "unrelated";
      return "late response";
    });
    await navigateToLspLocation(target);
    expect(mocks.openBuffer).not.toHaveBeenCalled();
    expect(mocks.pushEntry).not.toHaveBeenCalled();
  });

  it("leaves the source and jump history unchanged when reading fails", async () => {
    mocks.read.mockRejectedValueOnce(new Error("Missing file"));
    await expect(navigateToLspLocation(target)).rejects.toThrow("Missing file");
    expect(mocks.setActiveBuffer).not.toHaveBeenCalled();
    expect(mocks.pushEntry).not.toHaveBeenCalled();
    expect(mocks.requestNavigation).toHaveBeenLastCalledWith(null);
  });
});
