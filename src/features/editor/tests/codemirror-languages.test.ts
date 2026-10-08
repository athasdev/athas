import { ensureSyntaxTree, type LanguageSupport } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  hasCodeMirrorLanguage,
  LANGUAGE_LOADERS,
  loadCodeMirrorLanguage,
  resolveCodeMirrorLanguageId,
} from "../engines/codemirror/languages";
import { languages as codeBlockLanguages } from "../engines/codemirror/language-data";
import { getAllLanguages, getLanguageIdFromPath } from "../services/language-id";

vi.mock("@/extensions/registry/extension-registry", () => ({
  extensionRegistry: { getLanguageId: () => null },
}));

/** Language ids Monaco showed as plain text too, so CodeMirror has nothing to match. */
const PLAIN_TEXT_IDS = new Set(["text", "csv"]);

/**
 * Token names each kind of highlight is emitted under: the stream tokenizers name their syntax
 * nodes after the token (`keyword`, `fn`, `typeName`...), so a token is checked by its node name.
 */
const KINDS: Record<string, RegExp> = {
  keyword: /^(?:keyword|definitionKeyword|moduleKeyword|control)$/,
  function: /^(?:fn|builtinFn)$/,
  type: /^typeName$/,
  number: /^number$/,
  comment: /^(?:comment|docComment)$/,
  string: /^(?:string|stringSpecial|docString)$/,
  escape: /^escape$/,
  property: /^(?:propertyName|propertyDef)$/,
  bool: /^bool$/,
  null: /^null$/,
  atom: /^atom$/,
  namespace: /^namespace$/,
  variable: /^(?:variableName|definition|builtinConst|constant)$/,
  attribute: /^attributeName$/,
  tag: /^(?:tag|tagName)(?:_|$)/,
  operator: /^operator$/,
  heading: /^ATXHeading\d$/,
};

/** Every syntax node's text with its node name. */
function tokens(support: LanguageSupport, doc: string) {
  const state = EditorState.create({ doc, extensions: [support] });
  const tree = ensureSyntaxTree(state, doc.length, 5000);
  if (!tree) throw new Error("No syntax tree");
  const result: Array<[string, string]> = [];
  tree.iterate({
    enter: (node) => {
      if (!node.type.isTop && node.to > node.from) {
        result.push([doc.slice(node.from, node.to), node.type.name]);
      }
    },
  });
  return result;
}

async function tokensFor(languageId: string, doc: string) {
  const support = await loadCodeMirrorLanguage(languageId);
  if (!support) throw new Error(`No language for ${languageId}`);
  return tokens(support, doc);
}

function expectToken(found: Array<[string, string]>, text: string, kind: keyof typeof KINDS) {
  expect(found).toContainEqual([text, expect.stringMatching(KINDS[kind])]);
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(console, "warn");
});

afterEach(() => {
  expect(warn).not.toHaveBeenCalledWith(expect.stringContaining("highlighting tag"));
  warn.mockRestore();
});

describe("CodeMirror language coverage", () => {
  it("has highlighting for every language Athas lists", () => {
    const missing = getAllLanguages()
      .map((language) => language.id)
      .filter((id) => !PLAIN_TEXT_IDS.has(id) && !hasCodeMirrorLanguage(id));
    expect(missing).toEqual([]);
  });

  it("resolves the ids file names and extensions map to", () => {
    const paths = [
      "a.ex",
      "a.exs",
      "a.zig",
      "a.nix",
      "a.graphql",
      "a.gql",
      "main.tf",
      "x.tfvars",
      "Token.sol",
      "view.html.erb",
      "yarn.lock",
      "Dockerfile",
      "Containerfile",
      ".gitignore",
      ".gitattributes",
      ".env.local",
      "a.ml",
      "a.el",
      "a.elm",
      "a.proto",
      "a.ql",
      "a.ipynb",
      "a.Rmd",
      "a.svelte",
      "a.astro",
      "a.vue",
    ];
    const unresolved = paths.filter((path) => !hasCodeMirrorLanguage(getLanguageIdFromPath(path)));
    expect(unresolved).toEqual([]);
  });

  it("resolves aliases that language extensions and overrides use", () => {
    expect(resolveCodeMirrorLanguageId("c_sharp")).toBe("csharp");
    expect(resolveCodeMirrorLanguageId("hcl")).toBe("terraform");
    expect(resolveCodeMirrorLanguageId("shellscript")).toBe("bash");
    expect(resolveCodeMirrorLanguageId("Makefile")).toBe("makefile");
    expect(resolveCodeMirrorLanguageId("objective-c")).toBe("objc");
    expect(resolveCodeMirrorLanguageId("plaintext")).toBeNull();
    expect(resolveCodeMirrorLanguageId(null)).toBeNull();
  });

  it("loads every language", async () => {
    for (const id of Object.keys(LANGUAGE_LOADERS)) {
      const support = await loadCodeMirrorLanguage(id);
      expect(support, id).not.toBeNull();
      tokens(support!, "a = 1 # x\n");
    }
  });

  it("has Markdown code block languages for every block it names", async () => {
    for (const description of codeBlockLanguages) {
      const support = await description.load();
      expect(support, description.name).toBeTruthy();
    }
  });
});

describe("CodeMirror tokenizers", () => {
  it("highlights Zig", async () => {
    const found = await tokensFor(
      "zig",
      'const std = @import("std");\n/// docs\npub fn main() !void {\n  const x: u32 = 0x1f;\n  std.debug.print("hi\\n", .{});\n}\n',
    );
    expectToken(found, "const", "keyword");
    expectToken(found, "@import", "function");
    expectToken(found, "main", "function");
    expectToken(found, "u32", "type");
    expectToken(found, "0x1f", "number");
    expectToken(found, "/// docs", "comment");
    expectToken(found, "print", "function");
    expectToken(found, "debug", "property");
    expectToken(found, "\\n", "escape");
  });

  it("highlights Nix", async () => {
    const found = await tokensFor(
      "nix",
      "{ pkgs ? import <nixpkgs> {} }:\nlet name = \"x-${pkgs.version}\"; in\n# comment\nrec { enable = true; src = ./src; script = ''\n  echo hi\n''; }\n",
    );
    expectToken(found, "let", "keyword");
    expectToken(found, "import", "function");
    expectToken(found, "<nixpkgs>", "string");
    expectToken(found, "name", "property");
    expectToken(found, "true", "bool");
    expectToken(found, "./src", "string");
    expectToken(found, "# comment", "comment");
    expectToken(found, "  echo hi", "string");
  });

  it("highlights Elixir", async () => {
    const found = await tokensFor(
      "elixir",
      'defmodule Greeter do\n  @moduledoc """\n  Docs\n  """\n  def hello(name) when is_binary(name), do: "Hi #{name}"\n  # note\n  def ok, do: {:ok, ~r/a+/, nil, 1_000}\nend\n',
    );
    expectToken(found, "defmodule", "keyword");
    expectToken(found, "Greeter", "namespace");
    expectToken(found, "hello", "function");
    expectToken(found, "when", "keyword");
    expectToken(found, "do:", "atom");
    expectToken(found, ":ok", "atom");
    expectToken(found, "~r/a+/", "string");
    expectToken(found, "nil", "null");
    expectToken(found, "1_000", "number");
    expectToken(found, "# note", "comment");
    expectToken(found, "  Docs", "comment");
    expectToken(found, "name", "variable");
  });

  it("highlights GraphQL", async () => {
    const found = await tokensFor(
      "graphql",
      '# query\nquery Hero($id: ID!) @cached {\n  hero(id: $id) { name ...on Droid { primaryFunction } }\n}\ntype Query { role: Role = ADMIN }\n"""doc"""\n',
    );
    expectToken(found, "query", "keyword");
    expectToken(found, "$id", "variable");
    expectToken(found, "ID", "type");
    expectToken(found, "@cached", "attribute");
    expectToken(found, "hero", "function");
    expectToken(found, "Droid", "type");
    expectToken(found, "Query", "type");
    expectToken(found, "ADMIN", "variable");
    expectToken(found, "# query", "comment");
  });

  it("highlights Terraform", async () => {
    const found = await tokensFor(
      "terraform",
      'resource "aws_instance" "web" {\n  ami   = "ami-${var.id}"\n  count = 2\n  tags  = merge(local.tags, { Name = true })\n  # comment\n}\n',
    );
    expectToken(found, "resource", "keyword");
    expectToken(found, '"aws_instance"', "string");
    expectToken(found, "ami", "property");
    expectToken(found, "var", "variable");
    expectToken(found, "2", "number");
    expectToken(found, "merge", "function");
    expectToken(found, "true", "bool");
    expectToken(found, "# comment", "comment");
  });

  it("highlights Solidity", async () => {
    const found = await tokensFor(
      "solidity",
      "pragma solidity ^0.8.0;\n/// @notice docs\ncontract Token is ERC20 {\n  mapping(address => uint256) public balances;\n  function transfer(address to) external returns (bool) {\n    require(msg.sender != to, 'self');\n    return true;\n  }\n}\n",
    );
    expectToken(found, "pragma", "keyword");
    expectToken(found, "contract", "keyword");
    expectToken(found, "Token", "type");
    expectToken(found, "uint256", "type");
    expectToken(found, "transfer", "function");
    expectToken(found, "require", "function");
    expectToken(found, "'self'", "string");
    expectToken(found, "true", "bool");
    expectToken(found, "/// @notice docs", "comment");
  });

  it("highlights Makefiles", async () => {
    const found = await tokensFor(
      "makefile",
      "CC := gcc\n.PHONY: all\nall: main.o\n\t@$(CC) -o $@ $^ # build\nifeq ($(OS),Windows)\nendif\n",
    );
    expectToken(found, "CC", "property");
    expectToken(found, "all", "function");
    expectToken(found, "$@", "variable");
    expectToken(found, "# build", "comment");
    expectToken(found, "ifeq", "keyword");
  });

  it("highlights ERB with HTML outside the tags and Ruby inside them", async () => {
    const found = await tokensFor(
      "embedded_template",
      '<div class="a"><%= link_to "Home", root_path if true %></div>\n<%# note %>\n',
    );
    expectToken(found, "div", "tag");
    expectToken(found, "<%=", "tag");
    expectToken(found, '"Home"', "string");
    expectToken(found, "if", "keyword");
    expectToken(found, "<%# note %>", "comment");
  });

  it("highlights ignore files and lockfiles", async () => {
    const ignore = await tokensFor("gitignore", "# deps\n!keep/**/*.js\nnode_modules\n");
    expectToken(ignore, "# deps", "comment");
    expectToken(ignore, "/**/*", "operator");
    expectToken(ignore, "node_modules", "string");

    const lock = await tokensFor("lockfile", '"pkg@^1.0.0":\n  version "1.2.3"\n');
    expectToken(lock, '"pkg@^1.0.0"', "property");
    expectToken(lock, '"1.2.3"', "string");
  });

  it("highlights fenced code blocks in Markdown", async () => {
    const found = await tokensFor("markdown", "# Title\n\n```zig\nconst x = 1;\n```\n");
    expectToken(found, "# Title", "heading");
  });
});
