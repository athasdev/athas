import { describe, expect, it } from "vite-plus/test";
import { zigMonarchLanguage } from "../engines/monaco/zig-language";

// @ts-expect-error Monaco does not publish declarations for its Monarch compiler.
import { compile } from "monaco-editor/esm/vs/editor/standalone/common/monarch/monarchCompile.js";
// @ts-expect-error Monaco does not publish declarations for its Monarch tokenizer.
import { MonarchTokenizer } from "monaco-editor/esm/vs/editor/standalone/common/monarch/monarchLexer.js";

interface HighlightToken {
  text: string;
  type: string;
}

function tokenizeZig(source: string): HighlightToken[] {
  const disposable = { dispose() {} };
  const lexer = compile("zig", zigMonarchLanguage);
  const tokenizer = new MonarchTokenizer(
    {
      isRegisteredLanguageId: () => false,
      requestBasicLanguageFeatures() {},
      languageIdCodec: { encodeLanguageId: () => 1 },
    },
    {
      getColorTheme: () => ({ tokenTheme: { match: () => 0 } }),
    },
    "zig",
    lexer,
    {
      getValue: () => 20_000,
      onDidChangeConfiguration: () => disposable,
    },
  );

  try {
    let state = tokenizer.getInitialState();
    return source.split("\n").flatMap((line) => {
      const result = tokenizer.tokenize(line, true, state);
      state = result.endState;

      return result.tokens.map((token: { offset: number; type: string }, index: number) => ({
        text: line.slice(token.offset, result.tokens[index + 1]?.offset ?? line.length),
        type: token.type,
      }));
    });
  } finally {
    tokenizer.dispose();
  }
}

describe("Zig Monaco highlighting", () => {
  it("keeps keywords inside identifiers unstyled", () => {
    const tokens = tokenizeZig(`var command: ?[]const u8 = null;
const enabled = ready and valid;`);

    expect(tokens).toEqual(
      expect.arrayContaining([
        { text: "command", type: "variable.parameter.zig" },
        { text: "and", type: "keyword.zig" },
        { text: "var", type: "keyword.zig" },
        { text: "const", type: "keyword.zig" },
      ]),
    );
    expect(
      tokens.filter((token) => token.text === "and" && token.type === "keyword.zig"),
    ).toHaveLength(1);
  });

  it("distinguishes declarations, calls, fields, parameters, types, and builtins", () => {
    const tokens = tokenizeZig(`const std = @import("std");
pub fn build(b: *std.Build) void {
  const target = b.standardTargetOptions(.{});
  const mod = b.addModule("zsm", .{
    .root_source_file = b.path("src/root.zig"),
    .target = target,
  });
}`);

    expect(tokens).toEqual(
      expect.arrayContaining([
        { text: "std", type: "identifier.zig" },
        { text: "@import", type: "function.builtin.zig" },
        { text: "build", type: "function.call.zig" },
        { text: "b", type: "variable.parameter.zig" },
        { text: "Build", type: "type.identifier.zig" },
        { text: "standardTargetOptions", type: "function.method.call.zig" },
        { text: "root_source_file", type: "property.zig" },
        { text: "path", type: "function.method.call.zig" },
        { text: "target", type: "property.zig" },
      ]),
    );
  });
});
