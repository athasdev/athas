// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { CallHierarchyItem, TypeHierarchyItem } from "vscode-languageserver-protocol";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useJumpListStore } from "@/features/editor/stores/jump-list.store";
import { useEditorStateStore } from "@/features/editor/stores/state.store";
import { calculateCursorPositionFromContent } from "@/features/editor/utils/position";
import type { EditorContent, PaneContent } from "@/features/panes/types/pane-content.types";
import { useReferencesStore } from "@/features/references/stores/references.store";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useUIState } from "@/features/window/stores/ui-state.store";
import { workspaceRuntimeRegistry } from "@/features/workspace/runtime/workspace-runtime-registry";
import {
  goBack,
  goForward,
  goToDefinition,
  goToImplementation,
  goToReferences,
  goToTypeDefinition,
  openOutlinePanel,
  openOutlinePicker,
  showCallHierarchy,
  showTypeHierarchy,
} from "../commands/navigation-command-actions";

const mocks = vi.hoisted(() => {
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      invoke: vi.fn().mockResolvedValue([]),
      transformCallback: vi.fn(),
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    },
  });

  return {
    toast: { info: vi.fn(), success: vi.fn(), warning: vi.fn(), error: vi.fn() },
    showChoiceDialog: vi.fn(),
    navigateToLspLocation: vi.fn(),
    navigateToJumpEntry: vi.fn(),
    readFileContent: vi.fn(),
    lsp: {
      getDefinition: vi.fn(),
      getImplementation: vi.fn(),
      getTypeDefinition: vi.fn(),
      getReferences: vi.fn(),
      prepareCallHierarchy: vi.fn(),
      getIncomingCalls: vi.fn(),
      getOutgoingCalls: vi.fn(),
      prepareTypeHierarchy: vi.fn(),
      getSupertypes: vi.fn(),
      getSubtypes: vi.fn(),
    },
  };
});

vi.mock("sonner", () => ({ toast: mocks.toast }));

vi.mock("@/ui/dialog", () => ({ showChoiceDialog: mocks.showChoiceDialog }));

vi.mock("@/features/editor/lsp/lsp-client", () => ({
  LspClient: { getInstance: () => mocks.lsp },
}));

vi.mock("@/features/editor/lsp/location-navigation", () => ({
  navigateToLspLocation: mocks.navigateToLspLocation,
}));

vi.mock("@/features/editor/utils/jump-navigation", () => ({
  navigateToJumpEntry: mocks.navigateToJumpEntry,
}));

vi.mock("@/features/file-system/controllers/file-operations", () => ({
  readFileContent: mocks.readFileContent,
}));

vi.mock("@/features/settings/lib/settings-persistence", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/settings/lib/settings-persistence")>()),
  saveSettingsToStore: vi.fn(),
  debouncedSaveSettingsToStore: vi.fn(),
}));

const FILE_PATH = "/workspace/src/app.ts";

function editorBuffer(
  id: string,
  path: string,
  content: string,
  overrides: Partial<EditorContent> = {},
): EditorContent {
  return {
    id,
    type: "editor",
    path,
    name: path.split("/").pop() ?? path,
    content,
    savedContent: content,
    isDirty: false,
    isVirtual: false,
    isPinned: false,
    isPreview: false,
    isActive: false,
    language: "typescript",
    tokens: [],
    ...overrides,
  };
}

function openEditor(content: string, cursorOffset: number, extraBuffers: PaneContent[] = []) {
  useBufferStore.setState({
    activeBufferId: "app",
    buffers: [editorBuffer("app", FILE_PATH, content, { isActive: true }), ...extraBuffers],
  });
  useEditorStateStore.setState({
    cursorPosition: calculateCursorPositionFromContent(cursorOffset, content),
    selection: undefined,
    scrollTop: 40,
    scrollLeft: 4,
  });
}

function openNonEditor() {
  useBufferStore.setState({
    activeBufferId: "new-tab",
    buffers: [
      {
        id: "new-tab",
        type: "newTab",
        path: "newtab://1",
        name: "New Tab",
        isPinned: false,
        isPreview: false,
        isActive: true,
      },
    ],
  });
}

function lspRange(line: number, character: number, endCharacter = character + 3) {
  return {
    start: { line, character },
    end: { line, character: endCharacter },
  };
}

function hierarchyItem(name: string, uri: string, line: number, detail?: string) {
  return {
    name,
    detail,
    kind: 12,
    uri,
    range: lspRange(line, 0, 20),
    selectionRange: lspRange(line, 9),
  } satisfies CallHierarchyItem & TypeHierarchyItem;
}

function jumpEntry(bufferId: string, filePath: string, line: number) {
  return { bufferId, filePath, line, column: 0, offset: line * 10, scrollTop: 0, scrollLeft: 0 };
}

beforeEach(() => {
  workspaceRuntimeRegistry.resetForTests();
  useJumpListStore.setState({ entries: [], currentIndex: -1 });
  useReferencesStore.setState({ references: [], query: null, isLoading: false });
  useSettingsStore.setState((state) => ({
    settings: { ...state.settings, showOutline: false },
  }));
  mocks.navigateToLspLocation.mockResolvedValue(undefined);
  mocks.navigateToJumpEntry.mockResolvedValue(true);
});

afterEach(() => {
  useBufferStore.setState({
    activeBufferId: null,
    buffers: [],
    pendingClose: null,
    closedBuffersHistory: [],
  });
  vi.clearAllMocks();
});

describe("outline commands", () => {
  it("opens the command palette on the outline view for an editor", () => {
    openEditor("const a = 1;", 0);

    openOutlinePicker();

    expect(useUIState.getState()).toMatchObject({
      isCommandPaletteVisible: true,
      commandPaletteInitialView: "outline",
    });
  });

  it("shows the outline panel for an editor", () => {
    openEditor("const a = 1;", 0);

    openOutlinePanel();

    expect(useSettingsStore.getState().settings.showOutline).toBe(true);
  });

  it("ignores outline commands when no file editor is active", () => {
    openNonEditor();

    openOutlinePicker();
    openOutlinePanel();

    expect(useUIState.getState().isCommandPaletteVisible).toBe(false);
    expect(useSettingsStore.getState().settings.showOutline).toBe(false);
  });
});

describe("go to definition-style commands", () => {
  const content = "const value = helper();\nreturn value;";
  const cursorOffset = "const value = hel".length;

  it.each([
    ["definition", goToDefinition, "getDefinition"],
    ["implementation", goToImplementation, "getImplementation"],
    ["type definition", goToTypeDefinition, "getTypeDefinition"],
  ] as const)("navigates to the first %s at the cursor", async (_label, command, method) => {
    openEditor(content, cursorOffset);
    const first = { uri: "file:///workspace/src/helper.ts", range: lspRange(4, 16) };
    const second = { uri: "file:///workspace/src/other.ts", range: lspRange(1, 0) };
    mocks.lsp[method].mockResolvedValue([first, second]);

    await command();

    expect(mocks.lsp[method]).toHaveBeenCalledWith(FILE_PATH, 0, 17);
    expect(mocks.navigateToLspLocation).toHaveBeenCalledExactlyOnceWith(first);
  });

  it.each([
    ["definition", goToDefinition, "getDefinition", null],
    ["implementation", goToImplementation, "getImplementation", []],
    ["type definition", goToTypeDefinition, "getTypeDefinition", null],
  ] as const)("tells the user when no %s exists", async (label, command, method, result) => {
    openEditor(content, cursorOffset);
    mocks.lsp[method].mockResolvedValue(result);

    await command();

    expect(mocks.toast.info).toHaveBeenCalledWith(`No ${label} found.`);
    expect(mocks.navigateToLspLocation).not.toHaveBeenCalled();
  });

  it("does not query the language server without a file editor", async () => {
    openNonEditor();

    await goToDefinition();

    expect(mocks.lsp.getDefinition).not.toHaveBeenCalled();
    expect(mocks.toast.info).not.toHaveBeenCalled();
  });
});

describe("go to references", () => {
  it("shows a loading references view while the language server responds", async () => {
    openEditor("const total = 1;", "const to".length);
    let resolveReferences: (value: unknown[]) => void = () => {};
    mocks.lsp.getReferences.mockReturnValue(
      new Promise((resolve) => {
        resolveReferences = resolve;
      }),
    );

    const pending = goToReferences();
    await vi.waitFor(() => expect(mocks.lsp.getReferences).toHaveBeenCalled());

    const bufferState = useBufferStore.getState();
    const activeBuffer = bufferState.buffers.find((b) => b.id === bufferState.activeBufferId);
    expect(activeBuffer?.type).toBe("references");
    expect(useReferencesStore.getState().isLoading).toBe(true);

    resolveReferences([]);
    await pending;

    expect(useReferencesStore.getState()).toMatchObject({
      isLoading: false,
      references: [],
      query: { symbol: "total", filePath: FILE_PATH, line: 0, column: 8 },
    });
  });

  it("collects reference line text from open buffers and from disk", async () => {
    const appContent = "import { total } from './math';\nconsole.log(total);";
    const mathBuffer = editorBuffer(
      "math",
      "/workspace/src/math.ts",
      "// math\nexport const total = 1;",
    );
    openEditor(appContent, appContent.indexOf("total);") + 3, [mathBuffer]);
    mocks.readFileContent.mockImplementation(async (path: string) => {
      if (path === "/workspace/src/missing.ts") throw new Error("ENOENT");
      return "line zero\nline one\nprint(total)\n";
    });
    mocks.lsp.getReferences.mockResolvedValue([
      { uri: "file:///workspace/src/app.ts", range: lspRange(0, 9, 14) },
      { uri: "file:///workspace/src/math.ts", range: lspRange(1, 13, 18) },
      { uri: "file:///workspace/src/report.ts", range: lspRange(2, 6, 11) },
      { uri: "file:///workspace/src/missing.ts", range: lspRange(0, 0, 5) },
    ]);

    await goToReferences();

    expect(mocks.lsp.getReferences).toHaveBeenCalledWith(FILE_PATH, 1, 15);
    expect(mocks.readFileContent).toHaveBeenCalledTimes(2);
    expect(useReferencesStore.getState().query).toEqual({
      symbol: "total",
      filePath: FILE_PATH,
      line: 1,
      column: 15,
    });
    expect(useReferencesStore.getState().references).toEqual([
      {
        filePath: FILE_PATH,
        line: 0,
        column: 9,
        endLine: 0,
        endColumn: 14,
        lineContent: "import { total } from './math';",
      },
      {
        filePath: "/workspace/src/math.ts",
        line: 1,
        column: 13,
        endLine: 1,
        endColumn: 18,
        lineContent: "export const total = 1;",
      },
      {
        filePath: "/workspace/src/report.ts",
        line: 2,
        column: 6,
        endLine: 2,
        endColumn: 11,
        lineContent: "print(total)",
      },
      {
        filePath: "/workspace/src/missing.ts",
        line: 0,
        column: 0,
        endLine: 0,
        endColumn: 5,
        lineContent: "",
      },
    ]);
  });

  it("reads each referenced file only once", async () => {
    openEditor("x", 0);
    mocks.readFileContent.mockResolvedValue("a\nb\nc");
    mocks.lsp.getReferences.mockResolvedValue([
      { uri: "file:///workspace/src/lib.ts", range: lspRange(0, 0, 1) },
      { uri: "file:///workspace/src/lib.ts", range: lspRange(2, 0, 1) },
    ]);

    await goToReferences();

    expect(mocks.readFileContent).toHaveBeenCalledExactlyOnceWith("/workspace/src/lib.ts");
    expect(useReferencesStore.getState().references.map((ref) => ref.lineContent)).toEqual([
      "a",
      "c",
    ]);
  });

  it("falls back to a generic symbol name when the cursor is not on a word", async () => {
    openEditor("a  b", 2);
    mocks.lsp.getReferences.mockResolvedValue(null);

    await goToReferences();

    expect(useReferencesStore.getState().query?.symbol).toBe("symbol");
    expect(useReferencesStore.getState().references).toEqual([]);
  });

  it("does nothing when the active buffer has no file path", async () => {
    useBufferStore.setState({ activeBufferId: null, buffers: [] });

    await goToReferences();

    expect(mocks.lsp.getReferences).not.toHaveBeenCalled();
    expect(useReferencesStore.getState().query).toBeNull();
  });
});

describe("call hierarchy", () => {
  it("lets the user pick a caller or callee and navigates to it", async () => {
    openEditor("function run() {}", "function r".length);
    const root = hierarchyItem("run", "file:///workspace/src/app.ts", 0);
    const caller = hierarchyItem("main", "file:///workspace/src/main.ts", 3, "src/main.ts");
    const callee = hierarchyItem("log", "file:///workspace/src/log.ts", 7);
    mocks.lsp.prepareCallHierarchy.mockResolvedValue([root]);
    mocks.lsp.getIncomingCalls.mockResolvedValue([{ from: caller, fromRanges: [] }]);
    mocks.lsp.getOutgoingCalls.mockResolvedValue([{ to: callee, fromRanges: [] }]);
    mocks.showChoiceDialog.mockResolvedValue("1");

    await showCallHierarchy();

    expect(mocks.lsp.prepareCallHierarchy).toHaveBeenCalledWith(FILE_PATH, 0, 10);
    expect(mocks.lsp.getIncomingCalls).toHaveBeenCalledWith(FILE_PATH, root);
    expect(mocks.lsp.getOutgoingCalls).toHaveBeenCalledWith(FILE_PATH, root);
    expect(mocks.showChoiceDialog).toHaveBeenCalledWith("Choose a related call:", {
      title: "Call Hierarchy",
      choices: [
        { value: "0", label: "Caller: main — src/main.ts" },
        { value: "1", label: "Callee: log" },
      ],
    });
    expect(mocks.navigateToLspLocation).toHaveBeenCalledExactlyOnceWith({
      uri: callee.uri,
      range: callee.selectionRange,
    });
  });

  it("reports when there is no hierarchy at the cursor", async () => {
    openEditor("x", 0);
    mocks.lsp.prepareCallHierarchy.mockResolvedValue([]);

    await showCallHierarchy();

    expect(mocks.toast.info).toHaveBeenCalledWith("No call hierarchy found at the cursor.");
    expect(mocks.lsp.getIncomingCalls).not.toHaveBeenCalled();
  });

  it("reports when the symbol has no callers or callees", async () => {
    openEditor("x", 0);
    mocks.lsp.prepareCallHierarchy.mockResolvedValue([
      hierarchyItem("x", "file:///workspace/src/app.ts", 0),
    ]);
    mocks.lsp.getIncomingCalls.mockResolvedValue([]);
    mocks.lsp.getOutgoingCalls.mockResolvedValue([]);

    await showCallHierarchy();

    expect(mocks.toast.info).toHaveBeenCalledWith("No call hierarchy entries found.");
    expect(mocks.showChoiceDialog).not.toHaveBeenCalled();
  });

  it("caps the choices and stays put when the picker is dismissed", async () => {
    openEditor("x", 0);
    mocks.lsp.prepareCallHierarchy.mockResolvedValue([
      hierarchyItem("x", "file:///workspace/src/app.ts", 0),
    ]);
    mocks.lsp.getIncomingCalls.mockResolvedValue(
      Array.from({ length: 60 }, (_, index) => ({
        from: hierarchyItem(`caller${index}`, "file:///workspace/src/a.ts", index),
        fromRanges: [],
      })),
    );
    mocks.lsp.getOutgoingCalls.mockResolvedValue([]);
    mocks.showChoiceDialog.mockResolvedValue(null);

    await showCallHierarchy();

    expect(mocks.showChoiceDialog.mock.calls[0][1].choices).toHaveLength(50);
    expect(mocks.navigateToLspLocation).not.toHaveBeenCalled();
  });

  it("does nothing without a file editor", async () => {
    openNonEditor();

    await showCallHierarchy();

    expect(mocks.lsp.prepareCallHierarchy).not.toHaveBeenCalled();
  });
});

describe("type hierarchy", () => {
  it("lets the user pick a supertype or subtype and navigates to it", async () => {
    openEditor("class Dog extends Animal {}", "class D".length);
    const root = hierarchyItem("Dog", "file:///workspace/src/app.ts", 0);
    const supertype = hierarchyItem("Animal", "file:///workspace/src/animal.ts", 2);
    const subtype = hierarchyItem("Puppy", "file:///workspace/src/puppy.ts", 5, "puppy.ts");
    mocks.lsp.prepareTypeHierarchy.mockResolvedValue([root]);
    mocks.lsp.getSupertypes.mockResolvedValue([supertype]);
    mocks.lsp.getSubtypes.mockResolvedValue([subtype]);
    mocks.showChoiceDialog.mockResolvedValue("0");

    await showTypeHierarchy();

    expect(mocks.lsp.prepareTypeHierarchy).toHaveBeenCalledWith(FILE_PATH, 0, 7);
    expect(mocks.showChoiceDialog).toHaveBeenCalledWith("Choose a related type:", {
      title: "Type Hierarchy",
      choices: [
        { value: "0", label: "Supertype: Animal" },
        { value: "1", label: "Subtype: Puppy — puppy.ts" },
      ],
    });
    expect(mocks.navigateToLspLocation).toHaveBeenCalledExactlyOnceWith({
      uri: supertype.uri,
      range: supertype.selectionRange,
    });
  });

  it("reports when there is no type hierarchy at the cursor", async () => {
    openEditor("x", 0);
    mocks.lsp.prepareTypeHierarchy.mockResolvedValue([]);

    await showTypeHierarchy();

    expect(mocks.toast.info).toHaveBeenCalledWith("No type hierarchy found at the cursor.");
    expect(mocks.lsp.getSupertypes).not.toHaveBeenCalled();
  });

  it("reports when the type has no related types", async () => {
    openEditor("x", 0);
    mocks.lsp.prepareTypeHierarchy.mockResolvedValue([
      hierarchyItem("X", "file:///workspace/src/app.ts", 0),
    ]);
    mocks.lsp.getSupertypes.mockResolvedValue([]);
    mocks.lsp.getSubtypes.mockResolvedValue([]);

    await showTypeHierarchy();

    expect(mocks.toast.info).toHaveBeenCalledWith("No type hierarchy entries found.");
  });

  it("ignores an out-of-range choice", async () => {
    openEditor("x", 0);
    mocks.lsp.prepareTypeHierarchy.mockResolvedValue([
      hierarchyItem("X", "file:///workspace/src/app.ts", 0),
    ]);
    mocks.lsp.getSupertypes.mockResolvedValue([
      hierarchyItem("Base", "file:///workspace/src/base.ts", 0),
    ]);
    mocks.lsp.getSubtypes.mockResolvedValue([]);
    mocks.showChoiceDialog.mockResolvedValue("5");

    await showTypeHierarchy();

    expect(mocks.navigateToLspLocation).not.toHaveBeenCalled();
  });

  it("does nothing without a file editor", async () => {
    openNonEditor();

    await showTypeHierarchy();

    expect(mocks.lsp.prepareTypeHierarchy).not.toHaveBeenCalled();
  });
});

describe("jump list navigation", () => {
  it("goes back to the previous jump and remembers where it came from", async () => {
    openEditor("one\ntwo\nthree\nfour", "one\ntwo\nthr".length);
    const earlier = jumpEntry("lib", "/workspace/src/lib.ts", 12);
    useJumpListStore.getState().actions.pushEntry(earlier);

    await goBack();

    expect(mocks.navigateToJumpEntry).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining(earlier),
    );
    const { entries } = useJumpListStore.getState();
    expect(entries[entries.length - 1]).toMatchObject({
      bufferId: "app",
      filePath: FILE_PATH,
      line: 2,
      column: 3,
      offset: "one\ntwo\nthr".length,
      scrollTop: 40,
      scrollLeft: 4,
    });

    await goForward();

    expect(mocks.navigateToJumpEntry).toHaveBeenLastCalledWith(
      expect.objectContaining({ bufferId: "app", line: 2, column: 3 }),
    );
  });

  it("does not record a position when no file is active", async () => {
    useBufferStore.setState({ activeBufferId: null, buffers: [] });
    useJumpListStore.getState().actions.pushEntry(jumpEntry("a", "/workspace/a.ts", 1));
    useJumpListStore.getState().actions.pushEntry(jumpEntry("b", "/workspace/b.ts", 30));

    await goBack();

    expect(useJumpListStore.getState().entries).toHaveLength(2);
    expect(mocks.navigateToJumpEntry).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ bufferId: "a" }),
    );
  });

  it("stays put when there is nowhere to go", async () => {
    openEditor("x", 0);

    await goBack();
    await goForward();

    expect(mocks.navigateToJumpEntry).not.toHaveBeenCalled();
    expect(useJumpListStore.getState().entries).toEqual([]);
  });
});
