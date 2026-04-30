import { describe, expect, it } from "vite-plus/test";
import {
  applyTextEditsToContent,
  collectWorkspaceTextEdits,
  filePathFromUri,
  isWorkspaceEdit,
  offsetFromPosition,
} from "./workspace-edit";

describe("workspace edit utilities", () => {
  it("decodes file URIs into filesystem paths", () => {
    expect(filePathFromUri("file:///tmp/hello%20world.ts")).toBe("/tmp/hello world.ts");
  });

  it("converts LSP positions into string offsets", () => {
    expect(offsetFromPosition("one\ntwo\nthree", { line: 1, character: 2 })).toBe(6);
  });

  it("applies text edits from bottom to top", () => {
    expect(
      applyTextEditsToContent("const one = 1;\nconst two = 2;", [
        {
          range: {
            start: { line: 0, character: 6 },
            end: { line: 0, character: 9 },
          },
          newText: "first",
        },
        {
          range: {
            start: { line: 1, character: 6 },
            end: { line: 1, character: 9 },
          },
          newText: "second",
        },
      ]),
    ).toBe("const first = 1;\nconst second = 2;");
  });

  it("collects edits from changes and documentChanges", () => {
    const edit = {
      changes: {
        "file:///tmp/a.ts": [
          {
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 0 },
            },
            newText: "a",
          },
        ],
      },
      documentChanges: [
        {
          textDocument: { uri: "file:///tmp/a.ts" },
          edits: [
            {
              range: {
                start: { line: 1, character: 0 },
                end: { line: 1, character: 0 },
              },
              newText: "b",
            },
          ],
        },
      ],
    };

    expect(isWorkspaceEdit(edit)).toBe(true);
    expect(collectWorkspaceTextEdits(edit).get("/tmp/a.ts")).toHaveLength(2);
  });
});
