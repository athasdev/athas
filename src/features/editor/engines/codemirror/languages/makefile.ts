import type { StreamParser } from "@codemirror/language";
import { athasSimpleMode, words } from "./stream-tokens";

const directives = words(`
  include -include sinclude override export unexport define endef undefine ifdef ifndef ifeq ifneq
  else endif vpath
`);
const functions = words(`
  subst patsubst strip findstring filter filter-out sort word wordlist words firstword lastword dir
  notdir suffix basename addsuffix addprefix join wildcard realpath abspath error warning info
  shell origin flavor foreach if or and call eval file value let intcountx
`);

const variable = [
  { regex: /\$\(/, token: "punctuation", push: "variable" },
  { regex: /\$\{/, token: "punctuation", push: "braceVariable" },
  { regex: /\$[@<^+?*%$|]|\$\w/, token: "variableName" },
];

const base = athasSimpleMode({
  start: [
    { sol: true, regex: /(\t)([@+-]*)/, token: ["", "operator"], next: "recipe" },
    { regex: /#.*/, token: "comment" },
    ...variable,
    { sol: true, regex: /[A-Za-z_][\w.-]*(?=\s*(?:[:+?!]?=))/, token: "propertyDef" },
    { sol: true, regex: /\.[A-Z_]+(?=\s*:)/, token: "builtinConst" },
    { sol: true, regex: /[^:#=\s$][^:#=$]*?(?=\s*::?(?!=))/, token: "fn" },
    {
      sol: true,
      regex: /\s*-?[A-Za-z_][\w-]*(?=\s|$)/,
      token: (match) => (directives.has(match[0].trim()) ? "keyword" : null),
    },
    { regex: /::?=|\?=|\+=|!=|=|::?/, token: "operator" },
    { regex: /"(?:[^"\\]|\\.)*"?|'[^']*'?/, token: "string" },
    { regex: /[A-Za-z_][\w-]*/, token: (match) => (directives.has(match[0]) ? "keyword" : null) },
  ],
  recipe: [
    { regex: /#.*/, token: "comment" },
    ...variable,
    { regex: /"(?:[^"\\]|\\.)*"?|'[^']*'?/, token: "string" },
    { regex: /\\$/, token: "escape" },
    { regex: /[^$#"'\\]+|[$#"'\\]/, token: null },
  ],
  variable: [
    { regex: /\)/, token: "punctuation", pop: true },
    ...variable,
    {
      regex: /[A-Za-z_][\w-]*/,
      token: (match) => (functions.has(match[0]) ? "builtinFn" : "variableName"),
    },
    { regex: /[^)$\w]+/, token: null },
  ],
  braceVariable: [
    { regex: /\}/, token: "punctuation", pop: true },
    ...variable,
    {
      regex: /[A-Za-z_][\w-]*/,
      token: (match) => (functions.has(match[0]) ? "builtinFn" : "variableName"),
    },
    { regex: /[^}$\w]+/, token: null },
  ],
  languageData: {
    name: "makefile",
    commentTokens: { line: "#" },
  },
});

/** Makefiles: rules, variables, directives and the shell recipes under them. */
export const makefile: StreamParser<unknown> = {
  ...base,
  token(stream, state) {
    const mode = state as { state: string; stack?: string[] };
    if (stream.sol() && mode.state === "recipe" && stream.peek() !== "\t") {
      mode.state = "start";
      mode.stack = [];
    }
    return base.token(stream, state);
  },
};
