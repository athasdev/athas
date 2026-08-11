import { describe, expect, test, vi } from "vite-plus/test";

vi.mock("monaco-editor", () => {
  class Range {
    readonly startLineNumber: number;
    readonly startColumn: number;
    readonly endLineNumber: number;
    readonly endColumn: number;

    constructor(
      startLineNumber: number,
      startColumn: number,
      endLineNumber: number,
      endColumn: number,
    ) {
      this.startLineNumber = startLineNumber;
      this.startColumn = startColumn;
      this.endLineNumber = endLineNumber;
      this.endColumn = endColumn;
    }
  }

  return {
    Emitter: class {},
    Range,
    Uri: {
      parse(value: string) {
        const uri = new URL(value);
        return { scheme: uri.protocol.slice(0, -1), path: uri.pathname };
      },
    },
    editor: { addCommand: vi.fn() },
    languages: { registerCodeLensProvider: vi.fn() },
  };
});

import { toMonacoCodeLens } from "../engines/monaco/code-lens-provider";

describe("Monaco code lens provider", () => {
  test("maps show-references lenses to Monaco's native references command", () => {
    const lens = toMonacoCodeLens("/workspace/src/app.ts", {
      line: 4,
      title: "2 references",
      command: "editor.action.showReferences",
      arguments: [
        "file:///workspace/src/app.ts",
        { line: 4, character: 2 },
        [
          {
            uri: "file:///workspace/src/first.ts",
            range: {
              start: { line: 8, character: 3 },
              end: { line: 8, character: 7 },
            },
          },
        ],
      ],
    });

    expect(lens?.range).toMatchObject({
      startLineNumber: 5,
      startColumn: 1,
      endLineNumber: 5,
      endColumn: 1,
    });
    expect(lens?.command?.id).toBe("editor.action.showReferences");
    expect(lens?.command?.arguments?.[0]).toMatchObject({
      scheme: "file",
      path: "/workspace/src/app.ts",
    });
    expect(lens?.command?.arguments?.[1]).toEqual({ lineNumber: 5, column: 3 });
    expect(lens?.command?.arguments?.[2]).toMatchObject([
      {
        uri: { scheme: "file", path: "/workspace/src/first.ts" },
        range: {
          startLineNumber: 9,
          startColumn: 4,
          endLineNumber: 9,
          endColumn: 8,
        },
      },
    ]);
  });

  test("routes language-server commands through the Athas LSP command bridge", () => {
    const lens = toMonacoCodeLens("/workspace/src/main.rs", {
      line: 2,
      title: "Run test",
      command: "rust-analyzer.runSingle",
      arguments: [{ cargoArgs: ["test"] }],
    });

    expect(lens?.command).toMatchObject({
      id: "athas.executeLspCodeLens",
      title: "Run test",
      arguments: [
        {
          filePath: "/workspace/src/main.rs",
          lens: {
            command: "rust-analyzer.runSingle",
            arguments: [{ cargoArgs: ["test"] }],
          },
        },
      ],
    });
  });

  test("drops unresolved lenses without commands", () => {
    expect(
      toMonacoCodeLens("/workspace/src/app.ts", {
        line: 1,
        title: "Loading",
      }),
    ).toBeNull();
  });
});
