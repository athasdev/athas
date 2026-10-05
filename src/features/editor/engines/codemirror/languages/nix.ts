import { athasSimpleMode, words } from "./stream-tokens";

const keywords = words("assert else if in inherit let or rec then with");
const builtins = words(`
  abort baseNameOf builtins derivation derivationStrict dirOf fetchGit fetchMercurial fetchTarball
  fetchTree fromTOML import isNull map placeholder removeAttrs scopedImport throw toString
`);
const builtinConstants = words(
  "__currentSystem __currentTime __langVersion __nixPath __nixVersion __storeDir",
);

const interpolation = { regex: /\$\{/, token: "punctuation", push: "start" };

/** Nix, ported from the Monarch tokenizer Athas used with Monaco. */
export const nix = athasSimpleMode({
  start: [
    { regex: /#.*/, token: "comment" },
    { regex: /\/\*/, token: "comment", push: "comment" },
    { regex: /''/, token: "string", push: "indentedString" },
    { regex: /"/, token: "string", push: "string" },
    { regex: /<[A-Za-z0-9._+:/-]+>/, token: "stringSpecial" },
    { regex: /[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s;"')\]}]+/, token: "stringSpecial" },
    { regex: /(?:\.\.?|~)?\/[A-Za-z0-9._+@%=-][A-Za-z0-9._+@%/=-]*/, token: "stringSpecial" },
    { regex: /\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/, token: "number" },
    { regex: /[A-Za-z_][\w'-]*(?=\s*=(?!=))/, token: "propertyDef" },
    { regex: /[A-Za-z_][\w'-]*(?=\s*:(?!\/))/, token: "definition" },
    {
      regex: /[A-Za-z_][\w'-]*/,
      token: (match) => {
        const word = match[0];
        if (keywords.has(word)) return "keyword";
        if (word === "true" || word === "false") return "bool";
        if (word === "null") return "null";
        if (builtins.has(word)) return "builtinFn";
        if (builtinConstants.has(word)) return "builtinConst";
        return "variableName";
      },
    },
    { regex: /==|!=|<=|>=|&&|\|\||\/\/|\+\+|->|[=!<>+\-*/?@:]+/, token: "operator" },
    { regex: /\}/, token: "bracket", pop: true },
    { regex: /\{/, token: "bracket", push: "start" },
    { regex: /[[\]()]/, token: "bracket" },
    { regex: /[;.,]/, token: "punctuation" },
  ],
  string: [
    interpolation,
    { regex: /\\./, token: "escape" },
    { regex: /"/, token: "string", pop: true },
    { regex: /[^\\"$]+|\$/, token: "string" },
  ],
  indentedString: [
    interpolation,
    { regex: /'''|''\$|''\\./, token: "escape" },
    { regex: /''/, token: "string", pop: true },
    { regex: /[^'$]+|[$']/, token: "string" },
  ],
  comment: [
    { regex: /\*\//, token: "comment", pop: true },
    { regex: /[^*]+|\*/, token: "comment" },
  ],
  languageData: {
    name: "nix",
    commentTokens: { line: "#", block: { open: "/*", close: "*/" } },
  },
});
