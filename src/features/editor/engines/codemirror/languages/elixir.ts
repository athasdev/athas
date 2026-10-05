import { athasSimpleMode, words } from "./stream-tokens";

const keywords = words(`
  after and catch cond do else end fn for if in not or quote raise receive reraise rescue
  throw try unless unquote unquote_splicing when with case
`);
const definitionKeywords = words(`
  def defp defmacro defmacrop defmodule defprotocol defimpl defstruct defexception defdelegate
  defguard defguardp defoverridable defcallback
`);
const moduleKeywords = words("alias import require use");
const builtins = words("__MODULE__ __DIR__ __ENV__ __CALLER__ __STACKTRACE__ self");

const sigilBodies: Array<[string, RegExp]> = [
  ["\\(", /(?:[^)\\]|\\.)*\)[a-zA-Z]*/],
  ["\\[", /(?:[^\]\\]|\\.)*\][a-zA-Z]*/],
  ["\\{", /(?:[^}\\]|\\.)*\}[a-zA-Z]*/],
  ["<", /(?:[^>\\]|\\.)*>[a-zA-Z]*/],
  ["\\|", /(?:[^|\\]|\\.)*\|[a-zA-Z]*/],
  ["/", /(?:[^/\\]|\\.)*\/[a-zA-Z]*/],
  ['"', /(?:[^"\\]|\\.)*"[a-zA-Z]*/],
  ["'", /(?:[^'\\]|\\.)*'[a-zA-Z]*/],
];

const sigils = sigilBodies.map(([open, body]) => ({
  regex: new RegExp(`~[a-zA-Z]${open}${body.source}`),
  token: "stringSpecial",
}));

/** Elixir: modules, atoms, sigils, heredocs, interpolation and the def* family. */
export const elixir = athasSimpleMode({
  start: [
    { regex: /#.*/, token: "comment" },
    { regex: /@(?:moduledoc|doc|typedoc)\s+"""/, token: "docComment", push: "docHeredoc" },
    { regex: /"""/, token: "string", push: "heredoc" },
    { regex: /'''/, token: "string", push: "charHeredoc" },
    { regex: /~[a-zA-Z]"""/, token: "stringSpecial", push: "sigilHeredoc" },
    ...sigils,
    { regex: /"/, token: "string", push: "string" },
    { regex: /'(?:[^'\\]|\\.)*'/, token: "string" },
    { regex: /\?(?:\\.|[^\s\\])/, token: "atom" },
    { regex: /:"(?:[^"\\]|\\.)*"/, token: "atom" },
    { regex: /:[A-Za-z_][\w@]*[?!]?/, token: "atom" },
    { regex: /[A-Za-z_][\w@]*[?!]?:(?!:)/, token: "atom" },
    { regex: /@[A-Za-z_]\w*/, token: "attributeName" },
    {
      regex: /0x[0-9a-fA-F_]+|0o[0-7_]+|0b[01_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][-+]?\d+)?/,
      token: "number",
    },
    { regex: /[A-Z][\w]*(?:\.[A-Z][\w]*)*/, token: "namespace" },
    {
      regex: /(def|defp|defmacro|defmacrop|defguard|defguardp|defdelegate)(\s+)([a-z_]\w*[?!]?)/,
      token: ["definitionKeyword", "", "fn"],
    },
    { regex: /[a-z_][\w]*[?!]?(?=\s*\(|\s*\.\()/, token: "fn" },
    {
      regex: /[a-z_][\w]*[?!]?/,
      token: (match) => {
        const word = match[0];
        if (definitionKeywords.has(word)) return "definitionKeyword";
        if (moduleKeywords.has(word)) return "moduleKeyword";
        if (keywords.has(word)) return "keyword";
        if (word === "true" || word === "false") return "bool";
        if (word === "nil") return "null";
        if (builtins.has(word)) return "builtinConst";
        if (word.startsWith("_")) return "comment";
        return "variableName";
      },
    },
    {
      regex: /\|>|<>|<-|->|=>|\\\\|::|\+\+|--|\.\.|===?|!==?|<=|>=|&&|\|\||[-+*/=<>!&|^~@]/,
      token: "operator",
    },
    { regex: /[{}[\]()]|<<|>>/, token: "bracket" },
    { regex: /[,.;%]/, token: "punctuation" },
  ],
  interpolation: [
    { regex: /\}/, token: "punctuation", pop: true },
    { regex: /\{/, token: "bracket", push: "interpolation" },
    { regex: /"(?:[^"\\]|\\.)*"/, token: "string" },
    { regex: /:[A-Za-z_]\w*/, token: "atom" },
    { regex: /[A-Z]\w*/, token: "namespace" },
    { regex: /[a-z_]\w*[?!]?(?=\()/, token: "fn" },
    { regex: /[a-z_]\w*[?!]?/, token: "variableName" },
    { regex: /\d+(?:\.\d+)?/, token: "number" },
    { regex: /[^{}"\w:]+|:/, token: "operator" },
  ],
  string: [
    { regex: /#\{/, token: "punctuation", push: "interpolation" },
    { regex: /\\./, token: "escape" },
    { regex: /"/, token: "string", pop: true },
    { regex: /[^"\\#]+|#/, token: "string" },
  ],
  heredoc: [
    { regex: /#\{/, token: "punctuation", push: "interpolation" },
    { regex: /\\./, token: "escape" },
    { regex: /"""/, token: "string", pop: true },
    { regex: /[^"\\#]+|["#]/, token: "string" },
  ],
  charHeredoc: [
    { regex: /'''/, token: "string", pop: true },
    { regex: /[^']+|'/, token: "string" },
  ],
  docHeredoc: [
    { regex: /"""/, token: "docComment", pop: true },
    { regex: /[^"]+|"/, token: "docComment" },
  ],
  sigilHeredoc: [
    { regex: /"""[a-zA-Z]*/, token: "stringSpecial", pop: true },
    { regex: /[^"]+|"/, token: "stringSpecial" },
  ],
  languageData: {
    name: "elixir",
    commentTokens: { line: "#" },
    indentOnInput: /^\s*(?:end|else|rescue|catch|after|\))$/,
  },
});
