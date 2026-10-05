import { describe, expect, it } from "vite-plus/test";
import {
  lspSnippetToCodeMirror,
  lspSnippetToPlainText,
} from "../engines/codemirror/lsp/lsp-snippet";

describe("LSP snippet conversion", () => {
  it("converts tab stops, placeholders and the final cursor", () => {
    expect(lspSnippetToCodeMirror("foo($1, ${2:bar})$0")).toBe("foo(${1}, ${2:bar})${0}");
  });

  it("uses the first option of a choice", () => {
    expect(lspSnippetToCodeMirror("${1|let,const,var|} x")).toBe("${1:let} x");
  });

  it("escapes literal braces so CodeMirror does not read them as fields", () => {
    expect(lspSnippetToCodeMirror("fn main() {\n\t$0\n}")).toBe("fn main() \\{\n\t${0}\n\\}");
    expect(lspSnippetToCodeMirror("#{x}")).toBe("#\\{x\\}");
  });

  it("unescapes LSP escapes", () => {
    expect(lspSnippetToCodeMirror("\\$HOME \\} \\\\")).toBe("$HOME \\} \\");
  });

  it("flattens nested placeholders into their default text", () => {
    expect(lspSnippetToCodeMirror("${1:foo ${2:bar}}")).toBe("${1:foo bar}");
  });

  it("puts defaults that CodeMirror cannot hold in front of a bare tab stop", () => {
    expect(lspSnippetToCodeMirror("${1:{\\}}")).toBe("\\{\\}${1}");
  });

  it("resolves variables and falls back to their default or name", () => {
    const resolve = (name: string) => (name === "TM_FILENAME" ? "a.ts" : undefined);
    expect(lspSnippetToCodeMirror("$TM_FILENAME ${TM_FILENAME}", resolve)).toBe("a.ts a.ts");
    expect(lspSnippetToCodeMirror("${UNKNOWN:fallback}", resolve)).toBe("fallback");
    expect(lspSnippetToCodeMirror("$UNKNOWN", resolve)).toBe("${UNKNOWN}");
    expect(lspSnippetToCodeMirror("${TM_FILENAME/(.*)/$1/}", resolve)).toBe("a.ts");
  });

  it("keeps a dollar sign that starts nothing", () => {
    expect(lspSnippetToCodeMirror("cost: $ 5 ${")).toBe("cost: $ 5 $\\{");
  });

  it("produces plain text with defaults filled in", () => {
    expect(lspSnippetToPlainText("foo(${1:a}, $2)$0")).toBe("foo(a, )");
  });
});
