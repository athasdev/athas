import { describe, expect, test, vi } from "vite-plus/test";

vi.mock("monaco-editor", () => {
  class Range {
    constructor(
      readonly startLineNumber: number,
      readonly startColumn: number,
      readonly endLineNumber: number,
      readonly endColumn: number,
    ) {}
  }

  return {
    Emitter: class {},
    Range,
    Uri: { file: vi.fn(), parse: vi.fn() },
    editor: { addCommand: vi.fn() },
    languages: {
      CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
      CompletionItemKind: { Class: 6, Text: 18 },
      CompletionItemTag: { Deprecated: 1 },
    },
  };
});

import { toMonacoCompletionItem } from "../engines/monaco/lsp-providers";

describe("Monaco LSP completion mapping", () => {
  test("preserves lazy Java completion imports, labels, ranges, and commands", () => {
    const completion = toMonacoCompletionItem(
      {
        label: "ArrayList",
        labelDetails: { detail: "()", description: "java.util" },
        kind: 7,
        tags: [1],
        detail: "java.util.ArrayList",
        insertTextFormat: 2,
        textEdit: {
          newText: "ArrayList<${1:String}>($0)",
          insert: {
            start: { line: 4, character: 3 },
            end: { line: 4, character: 6 },
          },
          replace: {
            start: { line: 4, character: 3 },
            end: { line: 4, character: 12 },
          },
        },
        additionalTextEdits: [
          {
            range: {
              start: { line: 1, character: 0 },
              end: { line: 1, character: 0 },
            },
            newText: "import java.util.ArrayList;\n",
          },
        ],
        command: {
          title: "Record completion selection",
          command: "java.completion.onDidSelect",
          arguments: ["ArrayList"],
        },
      },
      {
        startLineNumber: 5,
        startColumn: 4,
        endLineNumber: 5,
        endColumn: 7,
      },
      "/repo/src/Main.java",
    );

    expect(completion).toMatchObject({
      label: { label: "ArrayList", detail: "()", description: "java.util" },
      kind: 6,
      tags: [1],
      insertText: "ArrayList<${1:String}>($0)",
      insertTextRules: 4,
      range: {
        insert: {
          startLineNumber: 5,
          startColumn: 4,
          endLineNumber: 5,
          endColumn: 7,
        },
        replace: {
          startLineNumber: 5,
          startColumn: 4,
          endLineNumber: 5,
          endColumn: 13,
        },
      },
      additionalTextEdits: [
        {
          range: {
            startLineNumber: 2,
            startColumn: 1,
            endLineNumber: 2,
            endColumn: 1,
          },
          text: "import java.util.ArrayList;\n",
        },
      ],
      command: {
        id: "athas.executeLspCompletionCommand",
        title: "Record completion selection",
        arguments: [
          {
            filePath: "/repo/src/Main.java",
            command: "java.completion.onDidSelect",
            arguments: ["ArrayList"],
          },
        ],
      },
    });
  });
});
