import { athasSimpleMode, words } from "./stream-tokens";

const keywords = words(`
  abstract anonymous as assembly break catch constant continue do else emit external fallback
  for if immutable indexed internal is new override payable private public pure receive return
  returns revert try unchecked view virtual while delete using memory storage calldata transient
  unicode let switch case default leave
`);
const definitionKeywords = words(
  "contract interface library function modifier event struct enum error constructor type",
);
const moduleKeywords = words("pragma import from solidity experimental abicoder");
const builtins = words(`
  msg block tx abi this super gasleft blockhash keccak256 sha256 ripemd160 ecrecover addmod
  mulmod selfdestruct require assert type now
`);
const units = words("wei gwei ether seconds minutes hours days weeks years");

const isType = (word: string) =>
  /^(?:address|bool|string|bytes|byte|var|mapping|fixed|ufixed)$/.test(word) ||
  /^u?int(?:8|16|24|32|40|48|56|64|72|80|88|96|104|112|120|128|136|144|152|160|168|176|184|192|200|208|216|224|232|240|248|256)?$/.test(
    word,
  ) ||
  /^bytes(?:[1-9]|[12]\d|3[0-2])$/.test(word) ||
  /^u?fixed\d+x\d+$/.test(word);

/** Solidity smart contracts. */
export const solidity = athasSimpleMode({
  start: [
    { regex: /\/\/\/.*/, token: "docComment" },
    { regex: /\/\/.*/, token: "comment" },
    { regex: /\/\*\*(?!\/)/, token: "docComment", push: "docComment" },
    { regex: /\/\*/, token: "comment", push: "comment" },
    { regex: /(?:unicode|hex)?"(?:[^"\\]|\\.)*"?/, token: "string" },
    { regex: /(?:unicode|hex)?'(?:[^'\\]|\\.)*'?/, token: "string" },
    {
      regex: /0x[0-9a-fA-F_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][-+]?\d+)?/,
      token: "number",
    },
    {
      regex: /(contract|interface|library|struct|enum|event|error|modifier)(\s+)([A-Za-z_$][\w$]*)/,
      token: ["definitionKeyword", "", "typeName"],
    },
    { regex: /(function)(\s+)([A-Za-z_$][\w$]*)/, token: ["definitionKeyword", "", "fn"] },
    {
      regex: /[A-Za-z_$][\w$]*(?=\s*\()/,
      token: (match) => {
        const word = match[0];
        if (keywords.has(word) || definitionKeywords.has(word)) return "keyword";
        if (isType(word)) return "typeName";
        if (builtins.has(word)) return "builtinFn";
        return "fn";
      },
    },
    {
      regex: /[A-Za-z_$][\w$]*/,
      token: (match) => {
        const word = match[0];
        if (word === "true" || word === "false") return "bool";
        if (definitionKeywords.has(word)) return "definitionKeyword";
        if (moduleKeywords.has(word)) return "moduleKeyword";
        if (keywords.has(word)) return "keyword";
        if (isType(word)) return "typeName";
        if (units.has(word)) return "keyword";
        if (builtins.has(word)) return "builtinConst";
        if (/^[A-Z][A-Z0-9_]+$/.test(word)) return "constant";
        if (/^[A-Z]/.test(word)) return "typeName";
        return "variableName";
      },
    },
    {
      regex: /=>|->|\+\+|--|\*\*|<<|>>|==|!=|<=|>=|&&|\|\||[-+*/%=&|^!<>?:~]=?/,
      token: "operator",
    },
    { regex: /[{}[\]()]/, token: "bracket" },
    { regex: /[;,.]/, token: "punctuation" },
  ],
  comment: [
    { regex: /\*\//, token: "comment", pop: true },
    { regex: /[^*]+|\*/, token: "comment" },
  ],
  docComment: [
    { regex: /\*\//, token: "docComment", pop: true },
    { regex: /@[A-Za-z]+(?::[A-Za-z]+)?/, token: "attributeName" },
    { regex: /[^*@]+|[*@]/, token: "docComment" },
  ],
  languageData: {
    name: "solidity",
    commentTokens: { line: "//", block: { open: "/*", close: "*/" } },
  },
});
