import { describe, expect, it } from "vite-plus/test";
import {
  applyTextEditsToContent,
  filePathFromUri,
  fileUriFromPath,
  isWorkspaceEdit,
  offsetFromPosition,
} from "../lsp/services/workspace-edit";

describe("workspace edit utilities", () => {
  it("decodes file URIs into filesystem paths", () => {
    expect(filePathFromUri("file:///tmp/hello%20world.ts")).toBe("/tmp/hello world.ts");
    expect(filePathFromUri("file:///C:/work/hello%20world.ts")).toBe("C:/work/hello world.ts");
    expect(filePathFromUri("file://server/share/hello%20world.ts")).toBe(
      "//server/share/hello world.ts",
    );
  });

  it("encodes filesystem paths as file URIs", () => {
    expect(fileUriFromPath("/tmp/hello world/#Main.java")).toBe(
      "file:///tmp/hello%20world/%23Main.java",
    );
    expect(fileUriFromPath("C:\\work\\Main.java")).toBe("file:///C:/work/Main.java");
  });

  it("converts LSP positions into string offsets", () => {
    expect(offsetFromPosition("one\ntwo\nthree", { line: 1, character: 2 })).toBe(6);
  });

  it("clamps LSP positions without rebuilding line arrays", () => {
    expect(offsetFromPosition("one\ntwo", { line: 10, character: 5 })).toBe(7);
    expect(offsetFromPosition("one\ntwo", { line: 1, character: 50 })).toBe(7);
    expect(() => offsetFromPosition("one\ntwo", { line: -1, character: -3 })).toThrow(
      "invalid text position",
    );
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

  it("applies same-line text edits using original document offsets", () => {
    expect(
      applyTextEditsToContent("0123456789", [
        {
          range: {
            start: { line: 0, character: 2 },
            end: { line: 0, character: 4 },
          },
          newText: "AA",
        },
        {
          range: {
            start: { line: 0, character: 6 },
            end: { line: 0, character: 8 },
          },
          newText: "BB",
        },
      ]),
    ).toBe("01AA45BB89");
  });

  it("accepts versioned document changes alongside legacy changes", () => {
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
  });

  it("rejects resource operations that the editor cannot apply", () => {
    expect(
      isWorkspaceEdit({
        documentChanges: [
          {
            kind: "create",
            uri: "file:///tmp/New.java",
          },
        ],
      }),
    ).toBe(false);
  });
});

describe("LSP text range edge cases", () => {
  const range = (start: number, end = start, newText = "!") => ({
    range: { start: { line: 0, character: start }, end: { line: 0, character: end } },
    newText,
  });
  it("preserves insert array order at the same position before a replacement", () => {
    expect(
      applyTextEditsToContent("abc", [range(1, 1, "A"), range(1, 1, "B"), range(1, 2, "C")]),
    ).toBe("aABCc");
  });
  it("rejects an insert after a replacement at the same position", () => {
    expect(() => applyTextEditsToContent("abc", [range(1, 2, "C"), range(1, 1, "A")])).toThrow(
      "Inserts must precede",
    );
  });
  it("rejects overlapping edits but accepts touching ranges", () => {
    expect(() => applyTextEditsToContent("abcdef", [range(1, 4), range(2, 3)])).toThrow(
      "overlapping",
    );
    expect(applyTextEditsToContent("abcdef", [range(0, 2), range(2, 4)])).toBe("!!ef");
  });
  it("counts UTF-16 code units and handles CRLF and lone CR without consuming line endings", () => {
    const text = "a😀\r\nb\rc";
    expect(offsetFromPosition(text, { line: 0, character: 100 })).toBe(3);
    expect(offsetFromPosition(text, { line: 1, character: 1 })).toBe(6);
    expect(offsetFromPosition(text, { line: 2, character: 0 })).toBe(7);
    expect(applyTextEditsToContent(text, [range(1, 3, "x")])).toBe("ax\r\nb\rc");
  });
  it.each([-1, 0.5, Infinity, 2147483648])("rejects invalid protocol positions %s", (character) => {
    expect(() => applyTextEditsToContent("abc", [range(character)])).toThrow(
      "unsupported text edit",
    );
  });
  it("rejects annotations when change-annotation support was not advertised", () => {
    expect(
      isWorkspaceEdit({
        changes: { "file:///p/a": [{ ...range(0), annotationId: "requires-confirmation" }] },
      }),
    ).toBe(false);
  });
  it("round trips UNC paths and POSIX filenames containing literal backslashes", () => {
    for (const path of ["//server/share/a b.ts", "/tmp/a\\b.ts", "/tmp/a%#?.ts"])
      expect(filePathFromUri(fileUriFromPath(path))).toBe(path);
    expect(fileUriFromPath("\\\\server\\share\\a.ts")).toBe("file://server/share/a.ts");
  });
  it("rejects unsupported documentChanges even when legacy changes are valid", () => {
    expect(
      isWorkspaceEdit({ changes: {}, documentChanges: [{ kind: "delete", uri: "file:///p/a" }] }),
    ).toBe(false);
  });
});
