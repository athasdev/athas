import { athasSimpleMode, words } from "./stream-tokens";

const keywords = words(`
  query mutation subscription fragment on schema type interface union enum input scalar extend
  directive implements repeatable
`);
const builtinTypes = words("Int Float String Boolean ID");

/** GraphQL schemas and documents. */
export const graphql = athasSimpleMode({
  start: [
    { regex: /#.*/, token: "comment" },
    { regex: /"""/, token: "docString", push: "blockString" },
    { regex: /"(?:[^"\\]|\\.)*"?/, token: "string" },
    { regex: /\$[A-Za-z_]\w*/, token: "variableName" },
    { regex: /@[A-Za-z_]\w*/, token: "attributeName" },
    { regex: /-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/, token: "number" },
    { regex: /\.\.\./, token: "operator" },
    { regex: /(on)(\s+)([A-Za-z_]\w*)/, token: ["keyword", "", "typeName"] },
    {
      regex: /(type|interface|union|enum|input|scalar|fragment)(\s+)([A-Za-z_]\w*)/,
      token: ["keyword", "", "typeName"],
    },
    { regex: /[A-Za-z_]\w*(?=\s*\()/, token: "fn" },
    { regex: /[A-Za-z_]\w*(?=\s*:)/, token: "propertyName" },
    {
      regex: /[A-Za-z_]\w*/,
      token: (match) => {
        const word = match[0];
        if (keywords.has(word)) return "keyword";
        if (word === "true" || word === "false") return "bool";
        if (word === "null") return "null";
        if (builtinTypes.has(word)) return "typeName";
        if (/^[A-Z][A-Z0-9_]+$/.test(word)) return "constant";
        if (/^[A-Z]/.test(word)) return "typeName";
        return "propertyName";
      },
    },
    { regex: /[!=|&:]/, token: "operator" },
    { regex: /[{}[\]()]/, token: "bracket" },
    { regex: /,/, token: "punctuation" },
  ],
  blockString: [
    { regex: /"""/, token: "docString", pop: true },
    { regex: /\\"""|[^"\\]+|["\\]/, token: "docString" },
  ],
  languageData: {
    name: "graphql",
    commentTokens: { line: "#" },
    closeBrackets: { brackets: ["(", "[", "{", '"'] },
  },
});
