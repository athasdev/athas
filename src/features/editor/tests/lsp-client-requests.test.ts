import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { commands } from "@/bindings/commands";
import type { Diagnostic } from "@/features/diagnostics/types/diagnostics.types";
import type { EditorContent } from "@/features/panes/types/pane-content.types";
import { seedActiveBuffer } from "@/features/panes/tests/helpers/seed-pane-tabs";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import { LspClient } from "../lsp/services/lsp-client";
import { useBufferStore } from "../stores/buffer.store";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(null) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => undefined) }));
vi.mock("@/extensions/registry/extension-registry", () => ({
  extensionRegistry: {
    getLanguageId: () => "typescript",
    getLspServerPath: (filePath: string) => (filePath.endsWith(".ts") ? "/bin/tsserver" : null),
  },
}));
vi.mock("@/features/file-system/services/workspace-resource-provider", () => ({
  getWorkspaceResourceProvider: () => ({
    readText: vi.fn().mockResolvedValue(""),
    writeText: vi.fn().mockResolvedValue(undefined),
  }),
}));

const FILE = "/ws/a.ts";
const client = LspClient.getInstance();
const canceled = () => Promise.reject(new Error("Request canceled: content modified"));
const failure = () => Promise.reject(new Error("server exploded"));
const position = { line: 0, character: 0 };
const range = { start: position, end: { line: 0, character: 5 } };

function editor(content: string): EditorContent {
  return {
    id: "a",
    type: "editor",
    path: FILE,
    name: "a.ts",
    content,
    savedContent: content,
    contentRevision: 0,
    isDirty: false,
    isVirtual: false,
    language: "typescript",
  };
}

const contentOf = () => (useBufferStore.getState().buffers[0] as EditorContent).content;

function semanticPayload(data: number[], legend: unknown): ArrayBuffer {
  const legendBytes = new TextEncoder().encode(JSON.stringify(legend));
  const buffer = new ArrayBuffer(8 + data.length * 4 + legendBytes.length);
  const view = new DataView(buffer);
  view.setUint32(0, data.length, true);
  view.setUint32(4, legendBytes.length, true);
  data.forEach((value, index) => view.setUint32(8 + index * 4, value, true));
  new Uint8Array(buffer, 8 + data.length * 4).set(legendBytes);
  return buffer;
}

beforeEach(() => {
  workspaceRuntimeRegistry.resetForTests();
  useBufferStore.setState({ buffers: [editor("hello world")] });
  seedActiveBuffer("a");
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  workspaceRuntimeRegistry.resetForTests();
});

describe("completion and hover", () => {
  it("returns completions and an empty list when the server fails", async () => {
    const items = [{ label: "log" }, { label: "warn" }];
    const request = vi.spyOn(commands, "lspGetCompletions").mockResolvedValueOnce(items as never);

    await expect(client.getCompletions(FILE, 1, 4, 2, ".")).resolves.toEqual(items);
    expect(request).toHaveBeenCalledWith(FILE, 1, 4, 2, ".");

    request.mockResolvedValueOnce([] as never);
    await expect(client.getCompletions(FILE, 1, 4)).resolves.toEqual([]);
    expect(request).toHaveBeenLastCalledWith(FILE, 1, 4, null, null);

    request.mockImplementationOnce(failure);
    await expect(client.getCompletions(FILE, 1, 4)).resolves.toEqual([]);
  });

  it("keeps the unresolved completion item when resolving fails", async () => {
    const item = { label: "log" };
    const resolved = { label: "log", detail: "(msg) => void" };
    const request = vi
      .spyOn(commands, "lspResolveCompletionItem")
      .mockResolvedValueOnce(resolved as never)
      .mockImplementationOnce(canceled)
      .mockImplementationOnce(failure);

    await expect(client.resolveCompletionItem(FILE, item)).resolves.toEqual(resolved);
    await expect(client.resolveCompletionItem(FILE, item)).resolves.toBe(item);
    await expect(client.resolveCompletionItem(FILE, item)).resolves.toBe(item);
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("returns hover content or null for benign and real failures", async () => {
    const hover = { contents: "string" };
    vi.spyOn(commands, "lspGetHover")
      .mockResolvedValueOnce(hover as never)
      .mockRejectedValueOnce("column is beyond end of line")
      .mockRejectedValueOnce({ message: "", code: 7 });

    await expect(client.getHover(FILE, 0, 1)).resolves.toEqual(hover);
    await expect(client.getHover(FILE, 0, 99)).resolves.toBeNull();
    await expect(client.getHover(FILE, 0, 1)).resolves.toBeNull();
    expect(console.error).toHaveBeenCalledTimes(1);
  });
});

describe("navigation", () => {
  it("routes definition, implementation and type definition to their own requests", async () => {
    const location = { uri: "file:///ws/b.ts", range };
    vi.spyOn(commands, "lspGetDefinition").mockResolvedValue([location] as never);
    vi.spyOn(commands, "lspGetImplementation").mockResolvedValue(null as never);
    vi.spyOn(commands, "lspGetTypeDefinition").mockImplementation(failure);

    await expect(client.getDefinition(FILE, 2, 3)).resolves.toEqual([location]);
    await expect(client.getImplementation(FILE, 2, 3)).resolves.toBeNull();
    await expect(client.getTypeDefinition(FILE, 2, 3)).resolves.toBeNull();
    expect(commands.lspGetImplementation).toHaveBeenCalledWith(FILE, 2, 3);
  });

  it("returns references and null on failure", async () => {
    const refs = [{ uri: "file:///ws/a.ts", range }];
    vi.spyOn(commands, "lspGetReferences")
      .mockResolvedValueOnce(refs as never)
      .mockResolvedValueOnce(null as never)
      .mockImplementationOnce(failure);

    await expect(client.getReferences(FILE, 0, 1)).resolves.toEqual(refs);
    await expect(client.getReferences(FILE, 0, 1)).resolves.toBeNull();
    await expect(client.getReferences(FILE, 0, 1)).resolves.toBeNull();
  });

  it("returns rename edits and prepare-rename ranges, or null", async () => {
    const edit = { changes: { "file:///ws/a.ts": [{ range, newText: "greeting" }] } };
    vi.spyOn(commands, "lspRename")
      .mockResolvedValueOnce(edit as never)
      .mockResolvedValueOnce(null as never)
      .mockImplementationOnce(failure);
    vi.spyOn(commands, "lspPrepareRename")
      .mockResolvedValueOnce({ range, placeholder: "hello" } as never)
      .mockImplementationOnce(failure);

    await expect(client.rename(FILE, 0, 1, "greeting")).resolves.toEqual(edit);
    await expect(client.rename(FILE, 0, 1, "greeting")).resolves.toBeNull();
    await expect(client.rename(FILE, 0, 1, "greeting")).resolves.toBeNull();
    await expect(client.prepareRename(FILE, 0, 1)).resolves.toEqual({
      range,
      placeholder: "hello",
    });
    await expect(client.prepareRename(FILE, 0, 1)).resolves.toBeNull();
  });
});

describe("document features", () => {
  it("decodes semantic tokens and swallows unavailable or canceled requests", async () => {
    vi.spyOn(commands, "lspGetSemanticTokens")
      .mockResolvedValueOnce(
        semanticPayload([0, 0, 5, 1, 0], {
          tokenTypes: ["variable", "function", 3],
          tokenModifiers: ["readonly"],
        }) as never,
      )
      .mockImplementationOnce(canceled)
      .mockResolvedValueOnce(new ArrayBuffer(4) as never);

    const tokens = await client.getSemanticTokens(FILE);
    expect(Array.from(tokens!.data)).toEqual([0, 0, 5, 1, 0]);
    expect(tokens!.tokenTypes).toEqual(["variable", "function"]);
    expect(tokens!.tokenModifiers).toEqual(["readonly"]);

    await expect(client.getSemanticTokens(FILE)).resolves.toBeNull();
    await expect(client.getSemanticTokens(FILE)).resolves.toBeNull();
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("turns null fields into missing ones for lenses, hints and symbols", async () => {
    vi.spyOn(commands, "lspGetCodeLens").mockResolvedValueOnce([
      { line: 3, title: "2 references", command: null, arguments: null },
    ] as never);
    vi.spyOn(commands, "lspGetInlayHints").mockResolvedValueOnce([
      {
        line: 1,
        character: 4,
        label: ": string",
        kind: null,
        paddingLeft: true,
        paddingRight: false,
      },
    ] as never);
    vi.spyOn(commands, "lspGetDocumentSymbols").mockResolvedValueOnce([
      {
        name: "main",
        kind: "function",
        detail: null,
        line: 0,
        character: 0,
        endLine: 4,
        endCharacter: 1,
        containerName: null,
        hierarchyPath: [0],
      },
    ] as never);
    vi.spyOn(commands, "lspGetWorkspaceSymbols").mockResolvedValueOnce([
      {
        name: "Widget",
        kind: "class",
        detail: null,
        line: 1,
        character: 0,
        endLine: 9,
        endCharacter: 1,
        containerName: "ui",
        filePath: "/ws/widget.ts",
      },
    ] as never);

    await expect(client.getCodeLens(FILE)).resolves.toEqual([
      { line: 3, title: "2 references", command: undefined, arguments: undefined },
    ]);
    await expect(client.getInlayHints(FILE, 0, 10)).resolves.toEqual([
      {
        line: 1,
        character: 4,
        label: ": string",
        kind: undefined,
        paddingLeft: true,
        paddingRight: false,
      },
    ]);
    const [symbol] = await client.getDocumentSymbols(FILE);
    expect(symbol).toMatchObject({ name: "main", hierarchyPath: [0] });
    expect(symbol.detail).toBeUndefined();
    const [workspaceSymbol] = await client.getWorkspaceSymbols("Wid", "/ws");
    expect(workspaceSymbol).toMatchObject({ name: "Widget", containerName: "ui" });
    expect(workspaceSymbol.detail).toBeUndefined();
    expect(commands.lspGetWorkspaceSymbols).toHaveBeenCalledWith("/ws", "Wid");
  });

  it("returns empty results when list requests fail or are canceled", async () => {
    for (const name of [
      "lspGetCodeLens",
      "lspGetFoldingRanges",
      "lspGetSelectionRanges",
      "lspGetDocumentHighlights",
      "lspPrepareCallHierarchy",
      "lspGetIncomingCalls",
      "lspGetOutgoingCalls",
      "lspPrepareTypeHierarchy",
      "lspGetSupertypes",
      "lspGetSubtypes",
      "lspGetOnTypeFormattingTriggerCharacters",
      "lspFormatOnType",
      "lspGetInlayHints",
      "lspGetDocumentSymbols",
      "lspGetWorkspaceSymbols",
      "lspGetSignatureTriggerCharacters",
    ] as const) {
      vi.spyOn(commands, name).mockImplementationOnce(canceled).mockImplementationOnce(failure);
    }
    const item = { name: "f" } as never;
    const calls = () => [
      client.getCodeLens(FILE),
      client.getFoldingRanges(FILE),
      client.getSelectionRanges(FILE, [position]),
      client.getDocumentHighlights(FILE, 0, 0),
      client.prepareCallHierarchy(FILE, 0, 0),
      client.getIncomingCalls(FILE, item),
      client.getOutgoingCalls(FILE, item),
      client.prepareTypeHierarchy(FILE, 0, 0),
      client.getSupertypes(FILE, item),
      client.getSubtypes(FILE, item),
      client.getOnTypeFormattingTriggerCharacters(FILE),
      client.formatOnType(FILE, 0, 0, "}", 2, true),
      client.getInlayHints(FILE, 0, 1),
      client.getDocumentSymbols(FILE),
      client.getWorkspaceSymbols("x", "/ws"),
      client.getSignatureTriggerCharacters(FILE),
    ];

    for (const result of await Promise.all(calls())) expect(result).toEqual([]);
    for (const result of await Promise.all(calls())) expect(result).toEqual([]);
  });

  it("passes list results through unchanged", async () => {
    const folding = [{ startLine: 0, endLine: 3 }];
    const selection = [{ range }];
    const highlights = [{ range, kind: 1 }];
    const hierarchy = [{ name: "f" }];
    const edits = [{ range, newText: "x" }];
    vi.spyOn(commands, "lspGetFoldingRanges").mockResolvedValueOnce(folding as never);
    vi.spyOn(commands, "lspGetSelectionRanges").mockResolvedValueOnce(selection as never);
    vi.spyOn(commands, "lspGetDocumentHighlights").mockResolvedValueOnce(highlights as never);
    vi.spyOn(commands, "lspPrepareCallHierarchy").mockResolvedValueOnce(hierarchy as never);
    vi.spyOn(commands, "lspGetIncomingCalls").mockResolvedValueOnce(hierarchy as never);
    vi.spyOn(commands, "lspGetOutgoingCalls").mockResolvedValueOnce(hierarchy as never);
    vi.spyOn(commands, "lspPrepareTypeHierarchy").mockResolvedValueOnce(hierarchy as never);
    vi.spyOn(commands, "lspGetSupertypes").mockResolvedValueOnce(hierarchy as never);
    vi.spyOn(commands, "lspGetSubtypes").mockResolvedValueOnce(hierarchy as never);
    vi.spyOn(commands, "lspGetOnTypeFormattingTriggerCharacters").mockResolvedValueOnce([
      "}",
    ] as never);
    vi.spyOn(commands, "lspFormatOnType").mockResolvedValueOnce(edits as never);
    vi.spyOn(commands, "lspGetSignatureTriggerCharacters").mockResolvedValueOnce(["("] as never);
    const item = { name: "f" } as never;

    await expect(client.getFoldingRanges(FILE)).resolves.toEqual(folding);
    await expect(client.getSelectionRanges(FILE, [position])).resolves.toEqual(selection);
    await expect(client.getDocumentHighlights(FILE, 0, 0)).resolves.toEqual(highlights);
    await expect(client.prepareCallHierarchy(FILE, 0, 0)).resolves.toEqual(hierarchy);
    await expect(client.getIncomingCalls(FILE, item)).resolves.toEqual(hierarchy);
    await expect(client.getOutgoingCalls(FILE, item)).resolves.toEqual(hierarchy);
    await expect(client.prepareTypeHierarchy(FILE, 0, 0)).resolves.toEqual(hierarchy);
    await expect(client.getSupertypes(FILE, item)).resolves.toEqual(hierarchy);
    await expect(client.getSubtypes(FILE, item)).resolves.toEqual(hierarchy);
    await expect(client.getOnTypeFormattingTriggerCharacters(FILE)).resolves.toEqual(["}"]);
    await expect(client.formatOnType(FILE, 1, 1, "}", 4, false)).resolves.toEqual(edits);
    expect(commands.lspFormatOnType).toHaveBeenCalledWith(FILE, 1, 1, "}", 4, false);
    await expect(client.getSignatureTriggerCharacters(FILE)).resolves.toEqual(["("]);
  });

  it("normalizes signature help and returns null when there is none", async () => {
    vi.spyOn(commands, "lspGetSignatureHelp")
      .mockResolvedValueOnce({
        signatures: [{ label: "f(a)", documentation: null, parameters: null, activeParameter: 0 }],
        activeSignature: 0,
        activeParameter: null,
      } as never)
      .mockResolvedValueOnce(null as never)
      .mockImplementationOnce(failure);

    const help = await client.getSignatureHelp(FILE, 0, 2);
    expect(help).toEqual({
      signatures: [
        { label: "f(a)", documentation: undefined, parameters: undefined, activeParameter: 0 },
      ],
      activeSignature: 0,
      activeParameter: undefined,
    });
    await expect(client.getSignatureHelp(FILE, 0, 2)).resolves.toBeNull();
    await expect(client.getSignatureHelp(FILE, 0, 2)).resolves.toBeNull();
  });
});

describe("formatting", () => {
  it("applies the server's document edits to the given text", async () => {
    vi.spyOn(commands, "lspFormatDocument")
      .mockResolvedValueOnce([
        {
          range: { start: { line: 0, character: 5 }, end: { line: 0, character: 6 } },
          newText: "\n",
        },
      ] as never)
      .mockResolvedValueOnce([] as never)
      .mockImplementationOnce(failure);

    await expect(client.formatDocument(FILE, "hello world")).resolves.toBe("hello\nworld");
    await expect(client.formatDocument(FILE, "unchanged")).resolves.toBe("unchanged");
    await expect(client.formatDocument(FILE, "x")).resolves.toBeNull();
  });

  it("formats a range with the requested coordinates", async () => {
    const request = vi
      .spyOn(commands, "lspFormatRange")
      .mockResolvedValueOnce([
        {
          range: { start: { line: 1, character: 0 }, end: { line: 1, character: 2 } },
          newText: "",
        },
      ] as never)
      .mockResolvedValueOnce([] as never)
      .mockImplementationOnce(failure);
    const target = { start: { line: 1, character: 0 }, end: { line: 1, character: 8 } };

    await expect(client.formatRange(FILE, "a\n  b\n", target)).resolves.toBe("a\nb\n");
    expect(request).toHaveBeenCalledWith(FILE, 1, 0, 1, 8);
    await expect(client.formatRange(FILE, "same", target)).resolves.toBe("same");
    await expect(client.formatRange(FILE, "x", target)).resolves.toBeNull();
  });
});

describe("code actions", () => {
  const diagnostic: Diagnostic = {
    filePath: FILE,
    severity: "error",
    line: 0,
    column: 0,
    endLine: 0,
    endColumn: 5,
    message: "Cannot find name 'hello'",
    source: "ts",
    code: "2304",
  };

  it("sends the diagnostic as both range and context", async () => {
    const request = vi.spyOn(commands, "lspGetCodeActions").mockResolvedValueOnce([
      {
        id: "1",
        title: "Add import",
        kind: null,
        isPreferred: true,
        hasEdit: true,
        hasCommand: false,
        payload: { title: "Add import" },
      },
    ] as never);

    const actions = await client.getCodeActions(FILE, diagnostic);

    expect(actions).toEqual([
      expect.objectContaining({ title: "Add import", kind: undefined, isPreferred: true }),
    ]);
    expect(request).toHaveBeenCalledWith(FILE, {
      startLine: 0,
      startColumn: 0,
      endLine: 0,
      endColumn: 5,
      diagnostics: [
        {
          line: 0,
          column: 0,
          endLine: 0,
          endColumn: 5,
          message: "Cannot find name 'hello'",
          source: "ts",
          code: "2304",
          severity: "error",
        },
      ],
    });
  });

  it("sends a plain range without diagnostics and survives failures", async () => {
    const request = vi
      .spyOn(commands, "lspGetCodeActions")
      .mockResolvedValueOnce([] as never)
      .mockImplementationOnce(failure);
    const selection = { startLine: 1, startColumn: 0, endLine: 2, endColumn: 0 };

    await expect(client.getCodeActions(FILE, selection)).resolves.toEqual([]);
    expect(request).toHaveBeenCalledWith(FILE, { ...selection, diagnostics: [] });
    await expect(client.getCodeActions(FILE, selection)).resolves.toEqual([]);
  });

  it("applies an action's workspace edit to the open document without running a command", async () => {
    const payload = {
      title: "Rename",
      edit: { changes: { [`file://${FILE}`]: [{ range, newText: "howdy" }] } },
    };
    vi.spyOn(commands, "lspGetCodeActions").mockResolvedValueOnce([
      { id: "1", title: "Rename", payload },
    ] as never);
    const apply = vi.spyOn(commands, "lspApplyCodeAction");
    const [action] = await client.getCodeActions(FILE, diagnostic);

    await expect(client.applyCodeAction(FILE, action.payload)).resolves.toEqual({ applied: true });

    expect(contentOf()).toBe("howdy world");
    expect(apply).not.toHaveBeenCalled();
  });

  it("refuses an action whose document changed after it was offered", async () => {
    const payload = {
      title: "Rename",
      edit: { changes: { [`file://${FILE}`]: [{ range, newText: "howdy" }] } },
    };
    vi.spyOn(commands, "lspGetCodeActions").mockResolvedValueOnce([
      { id: "1", title: "Rename", payload },
    ] as never);
    const [action] = await client.getCodeActions(FILE, diagnostic);
    useBufferStore.getState().actions.updateBufferContent("a", "hello there", true);

    const result = await client.applyCodeAction(FILE, action.payload);

    expect(result.applied).toBe(false);
    expect(contentOf()).toBe("hello there");
  });

  it("applies the edit, then runs the command without the edit", async () => {
    const payload = {
      title: "Fix and organize",
      edit: { changes: { [`file://${FILE}`]: [{ range, newText: "howdy" }] } },
      command: { command: "organize" },
    };
    const apply = vi
      .spyOn(commands, "lspApplyCodeAction")
      .mockResolvedValueOnce({ applied: false, reason: null } as never);

    await expect(client.applyCodeAction(FILE, payload)).resolves.toEqual({
      applied: true,
      reason: undefined,
    });
    expect(contentOf()).toBe("howdy world");
    expect(apply).toHaveBeenCalledWith(FILE, {
      title: "Fix and organize",
      command: { command: "organize" },
    });
  });

  it("explains disabled, malformed and failing actions", async () => {
    vi.spyOn(commands, "lspApplyCodeAction")
      .mockResolvedValueOnce({ applied: true, reason: null } as never)
      .mockRejectedValueOnce({ message: "no handler", code: "E1" });

    await expect(
      client.applyCodeAction(FILE, { disabled: { reason: "Nothing to fix" } }),
    ).resolves.toEqual({ applied: false, reason: "Nothing to fix" });
    await expect(client.applyCodeAction(FILE, { disabled: {} })).resolves.toEqual({
      applied: false,
      reason: "Action is disabled",
    });
    await expect(client.applyCodeAction(FILE, { edit: "nonsense" })).resolves.toEqual({
      applied: false,
      reason: "Language server returned an unsupported workspace edit",
    });
    await expect(client.applyCodeAction(FILE, "command-id")).resolves.toEqual({
      applied: true,
      reason: undefined,
    });
    await expect(client.applyCodeAction(FILE, { command: {} })).resolves.toEqual({
      applied: false,
      reason: "no handler",
    });
    expect(contentOf()).toBe("hello world");
  });
});

describe("commands and support checks", () => {
  it("runs workspace commands and Java class file requests", async () => {
    vi.spyOn(commands, "lspExecuteCommand").mockResolvedValueOnce({ ok: true } as never);
    vi.spyOn(commands, "lspGetJavaClassFileContents").mockResolvedValueOnce("class A {}" as never);

    await expect(client.executeCommand(FILE, "do.it", [1])).resolves.toEqual({ ok: true });
    expect(commands.lspExecuteCommand).toHaveBeenCalledWith(FILE, "do.it", [1]);
    await expect(client.getJavaClassFileContents(FILE, "jdt://A.class")).resolves.toBe(
      "class A {}",
    );
  });

  it("swallows save notification failures", async () => {
    vi.spyOn(commands, "lspDocumentSave").mockRejectedValueOnce(new Error("not open"));
    await expect(client.notifyDocumentSave(FILE)).resolves.toBeUndefined();
  });

  it("knows which files have a language server", async () => {
    await expect(client.isLanguageSupported(FILE)).resolves.toBe(true);
    await expect(client.isLanguageSupported("/ws/a.md")).resolves.toBe(false);
  });
});
