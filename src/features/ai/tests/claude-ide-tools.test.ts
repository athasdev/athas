import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  fileUriToPath,
  findOpenFileSelection,
  offsetToPosition,
  pathToFileUri,
  runClaudeIdeTool,
} from "@/features/ai/integrations/claude-code/services/claude-ide-tools";

const mocks = vi.hoisted(() => ({
  buffers: [] as unknown[],
  diagnostics: new Map<string, unknown[]>(),
  closeBuffer: vi.fn(),
  closeDiffByTabName: vi.fn(() => false),
  closeAllDiffs: vi.fn(() => 0),
}));

vi.mock("@/features/editor/stores/buffer.store", () => ({
  useBufferStore: {
    getState: () => ({ buffers: mocks.buffers, actions: { closeBuffer: mocks.closeBuffer } }),
  },
}));
vi.mock("@/features/panes/stores/pane-selectors", () => ({ getActiveBufferId: () => "b" }));
vi.mock("@/features/diagnostics/stores/diagnostics.store", () => ({
  useDiagnosticsStore: { getState: () => ({ diagnosticsByFile: mocks.diagnostics }) },
}));
vi.mock("@/features/editor/services/buffer-text", () => ({
  readBufferText: (buffer: { content: string }) => buffer.content,
}));
vi.mock("@/features/editor/services/editor-save-service", () => ({
  saveEditorBufferById: vi.fn(async () => true),
}));
vi.mock("@/features/editor/services/buffer-store-owner", () => ({
  captureBufferStoreOwner: () => ({}),
}));
vi.mock("@/features/editor/stores/state.store", () => ({
  useEditorStateStore: { getState: () => ({ actions: { requestNavigation: vi.fn() } }) },
}));
vi.mock("@/features/file-system/stores/file-system.store", () => ({
  useFileSystemStore: { getState: () => ({ handleFileSelect: vi.fn() }) },
}));
vi.mock("@/features/ai/lib/open-tool-location", () => ({
  resolveToolPath: async (path: string) => path,
}));
vi.mock("@/features/ai/integrations/claude-code/services/claude-ide-diff-review", () => ({
  openClaudeDiff: vi.fn(),
  closeClaudeDiffByTabName: mocks.closeDiffByTabName,
  closeAllClaudeDiffs: mocks.closeAllDiffs,
}));

function editor(id: string, path: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    path,
    name: path.split("/").pop(),
    type: "editor",
    isVirtual: false,
    isDirty: false,
    content: "one\ntwo\n",
    language: "typescript",
    ...extra,
  };
}

function request(tool: string, args: Record<string, unknown> = {}) {
  return { requestId: "r1", tool, arguments: args, windowLabel: "main" };
}

describe("Claude Code editor tools", () => {
  beforeEach(() => {
    mocks.buffers = [];
    mocks.diagnostics = new Map();
    mocks.closeBuffer.mockReset();
    mocks.closeDiffByTabName.mockReset().mockReturnValue(false);
  });

  it("finds the openFile selection from text patterns or 1-based lines", () => {
    const text = "alpha\nfunction hello() {\n  return 1;\n}\n";
    const from = text.indexOf("function");
    expect(findOpenFileSelection(text, { startText: "function hello" })).toEqual({
      from,
      to: from + "function hello".length,
    });
    expect(findOpenFileSelection(text, { startText: "function", endText: "}" })).toEqual({
      from,
      to: text.lastIndexOf("}") + 1,
    });
    expect(findOpenFileSelection(text, { startText: "return", selectToEndOfLine: true })).toEqual({
      from: text.indexOf("return"),
      to: text.indexOf(";") + 1,
    });
    expect(findOpenFileSelection(text, { startLine: 2, endLine: 3 })).toEqual({
      from: 6,
      to: text.indexOf(";") + 1,
    });
    expect(findOpenFileSelection(text, { startText: "missing" })).toBeNull();
    expect(findOpenFileSelection(text, {})).toBeNull();
  });

  it("converts offsets to zero-based positions", () => {
    expect(offsetToPosition("ab\ncd", 4)).toEqual({ line: 1, column: 1, offset: 4 });
    expect(offsetToPosition("ab", 99)).toEqual({ line: 0, column: 2, offset: 2 });
  });

  it("round-trips file URIs", () => {
    expect(pathToFileUri("/a b/c#.ts")).toBe("file:///a%20b/c%23.ts");
    expect(fileUriToPath("file:///a%20b/c%23.ts")).toBe("/a b/c#.ts");
    expect(fileUriToPath("file:///C:/x.ts")).toBe("C:/x.ts");
  });

  it("lists open editors and their state", async () => {
    mocks.buffers = [
      editor("a", "/repo/a.ts", { isDirty: true }),
      editor("b", "/repo/b.ts"),
      editor("v", "/repo/virtual.ts", { isVirtual: true }),
      { id: "t", type: "terminal", path: "terminal://1", name: "zsh" },
    ];
    const [text] = await runClaudeIdeTool(request("getOpenEditors"));
    const { tabs } = JSON.parse(text ?? "{}");
    expect(tabs.map((tab: { fileName: string }) => tab.fileName)).toEqual([
      "/repo/a.ts",
      "/repo/b.ts",
    ]);
    expect(tabs[0]).toMatchObject({ uri: "file:///repo/a.ts", isDirty: true, isActive: false });
    expect(tabs[1]).toMatchObject({ isActive: true, languageId: "typescript", lineCount: 3 });
  });

  it("reports whether an open document is dirty", async () => {
    mocks.buffers = [editor("a", "/repo/a.ts", { isDirty: true })];
    const [dirty] = await runClaudeIdeTool(
      request("checkDocumentDirty", { filePath: "/repo/a.ts" }),
    );
    expect(JSON.parse(dirty ?? "")).toEqual({
      success: true,
      filePath: "/repo/a.ts",
      isDirty: true,
      isUntitled: false,
    });
    const [missing] = await runClaudeIdeTool(
      request("checkDocumentDirty", { filePath: "/repo/z.ts" }),
    );
    expect(JSON.parse(missing ?? "")).toEqual({
      success: false,
      message: "Document not open: /repo/z.ts",
    });
  });

  it("maps diagnostics onto the VS Code shape", async () => {
    mocks.diagnostics.set("/repo/a.ts", [
      {
        severity: "error",
        filePath: "/repo/a.ts",
        line: 1,
        column: 2,
        endLine: 1,
        endColumn: 5,
        message: "bad",
        source: "ts",
        code: "2304",
      },
    ]);
    mocks.diagnostics.set("/repo/clean.ts", []);
    const [all] = await runClaudeIdeTool(request("getDiagnostics"));
    expect(JSON.parse(all ?? "")).toEqual([
      {
        uri: "file:///repo/a.ts",
        diagnostics: [
          {
            message: "bad",
            severity: "Error",
            range: { start: { line: 1, character: 2 }, end: { line: 1, character: 5 } },
            source: "ts",
            code: "2304",
          },
        ],
      },
    ]);
    const [one] = await runClaudeIdeTool(
      request("getDiagnostics", { uri: "file:///repo/clean.ts" }),
    );
    expect(JSON.parse(one ?? "")).toEqual([{ uri: "file:///repo/clean.ts", diagnostics: [] }]);
  });

  it("closes Claude diff tabs first, then editor tabs by name", async () => {
    mocks.buffers = [editor("a", "/repo/a.ts")];
    expect(await runClaudeIdeTool(request("close_tab", { tab_name: "a.ts" }))).toEqual([
      "TAB_CLOSED",
    ]);
    expect(mocks.closeBuffer).toHaveBeenCalledWith("a");

    mocks.closeDiffByTabName.mockReturnValue(true);
    mocks.closeBuffer.mockReset();
    await runClaudeIdeTool(request("close_tab", { tab_name: "a.ts" }));
    expect(mocks.closeBuffer).not.toHaveBeenCalled();

    mocks.closeAllDiffs.mockReturnValue(2);
    expect(await runClaudeIdeTool(request("closeAllDiffTabs"))).toEqual(["CLOSED_2_DIFF_TABS"]);
  });

  it("rejects tools Athas does not implement", async () => {
    await expect(runClaudeIdeTool(request("executeCode", { code: "1" }))).rejects.toThrow(
      "does not support the executeCode tool",
    );
  });
});
