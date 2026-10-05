import { athasSimpleMode, words } from "./stream-tokens";

const blockTypes = words(`
  resource data module variable output locals provider terraform backend required_providers
  provisioner connection lifecycle dynamic content moved import check removed
`);
const keywords = words("for in if else endif endfor");
const builtinTypes = words("string number bool list map set object tuple any");

const interpolation = { regex: /[$%]\{/, token: "punctuation", push: "template" };

/** HCL, which Terraform, Packer and Nomad files are written in. */
export const hcl = athasSimpleMode({
  start: [
    { regex: /(?:#|\/\/).*/, token: "comment" },
    { regex: /\/\*/, token: "comment", push: "comment" },
    { regex: /(<<-?)([A-Za-z_]\w*)/, token: ["operator", "string"], push: "heredoc" },
    { regex: /"/, token: "string", push: "string" },
    { regex: /\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/, token: "number" },
    { regex: /[A-Za-z_][\w-]*(?=\s*=(?!=))/, token: "propertyDef" },
    { regex: /[A-Za-z_][\w-]*(?=\s*\()/, token: "builtinFn" },
    {
      sol: true,
      regex: /\s*[A-Za-z_][\w-]*(?=(?:\s+(?:"[^"]*"|[A-Za-z_][\w-]*))*\s*\{)/,
      token: (match) => (blockTypes.has(match[0].trim()) ? "keyword" : "typeName"),
    },
    {
      regex: /[A-Za-z_][\w-]*/,
      token: (match) => {
        const word = match[0];
        if (word === "true" || word === "false") return "bool";
        if (word === "null") return "null";
        if (keywords.has(word)) return "control";
        if (builtinTypes.has(word)) return "typeName";
        if (blockTypes.has(word)) return "keyword";
        return "variableName";
      },
    },
    { regex: /=>|==|!=|<=|>=|&&|\|\||\.\.\.|[-+*/%=<>!?:]/, token: "operator" },
    { regex: /\}/, token: "bracket", pop: true },
    { regex: /\{/, token: "bracket", push: "start" },
    { regex: /[[\]()]/, token: "bracket" },
    { regex: /[,.]/, token: "punctuation" },
  ],
  string: [
    interpolation,
    { regex: /\\./, token: "escape" },
    { regex: /[$%]\$\{|%%\{/, token: "escape" },
    { regex: /"/, token: "string", pop: true },
    { regex: /[^"\\$%]+|[$%]/, token: "string" },
  ],
  template: [
    { regex: /~?\}/, token: "punctuation", pop: true },
    { regex: /"/, token: "string", push: "string" },
    { regex: /\d+(?:\.\d+)?/, token: "number" },
    { regex: /[A-Za-z_][\w-]*(?=\s*\()/, token: "builtinFn" },
    {
      regex: /[A-Za-z_][\w-]*/,
      token: (match) => (keywords.has(match[0]) ? "control" : "variableName"),
    },
    { regex: /[^}"\w]+/, token: "operator" },
  ],
  heredoc: [
    { sol: true, regex: /\s*[A-Za-z_]\w*\s*$/, token: "string", pop: true },
    interpolation,
    { regex: /[^$%]+|[$%]/, token: "string" },
  ],
  comment: [
    { regex: /\*\//, token: "comment", pop: true },
    { regex: /[^*]+|\*/, token: "comment" },
  ],
  languageData: {
    name: "hcl",
    commentTokens: { line: "#", block: { open: "/*", close: "*/" } },
  },
});
