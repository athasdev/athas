import { athasSimpleMode, classifyWord, words } from "./stream-tokens";

const keywords = words(`
  addrspace align allowzero and anyframe anytype asm async await break callconv catch comptime
  const continue defer else enum errdefer error export extern fn for if inline linksection noalias
  noinline nosuspend opaque or orelse packed pub resume return struct suspend switch test
  threadlocal try union unreachable usingnamespace var volatile while
`);
const constants = words("true false null undefined");
const types = words(`
  u8 u16 u32 u64 u128 usize i8 i16 i32 i64 i128 isize f16 f32 f64 f80 f128 bool void noreturn
  type anyerror anyopaque comptime_int comptime_float c_char c_short c_ushort c_int c_uint c_long
  c_ulong c_longlong c_ulonglong c_longdouble
`);

/** Zig, ported from the Monarch tokenizer Athas used with Monaco. */
export const zig = athasSimpleMode({
  start: [
    { regex: /\/\/\/.*/, token: "docComment" },
    { regex: /\/\/.*/, token: "comment" },
    { regex: /\\\\.*/, token: "string" },
    { regex: /"(?:[^"\\]|\\.)*$/, token: "string" },
    { regex: /"/, token: "string", push: "string" },
    { regex: /'(?:[^'\\]|\\.)*'/, token: "string" },
    { regex: /@[A-Za-z_]\w*/, token: "builtinFn" },
    {
      regex:
        /0x[0-9a-fA-F_]+(?:\.[0-9a-fA-F_]+)?(?:[pP][-+]?\d+)?|0o[0-7_]+|0b[01_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][-+]?\d+)?/,
      token: "number",
    },
    { regex: /(\.)([A-Za-z_]\w*)(?=\s*\()/, token: ["punctuation", "fn"] },
    { regex: /(\.)([A-Z][A-Za-z0-9_]*)/, token: ["punctuation", "typeName"] },
    { regex: /(\.)([A-Za-z_]\w*)/, token: ["punctuation", "propertyName"] },
    {
      regex: /[A-Za-z_]\w*(?=\s*\()/,
      token: classifyWord([[keywords, "keyword"]], "fn"),
    },
    {
      regex: /[A-Za-z_]\w*/,
      token: (match) => {
        const word = match[0];
        if (keywords.has(word)) return "keyword";
        if (constants.has(word)) return word === "null" || word === "undefined" ? "null" : "bool";
        if (types.has(word)) return "typeName";
        if (/^[A-Z]/.test(word)) return "typeName";
        return "variableName";
      },
    },
    {
      regex: /==|!=|<=|>=|=>|<<|>>|\+%|-%|\*%|\+\||-\||\*\||\*\*|\+\+|[-+*/%=&|^!<>?:~]+/,
      token: "operator",
    },
    { regex: /[{}[\]()]/, token: "bracket" },
    { regex: /[;,.]/, token: "punctuation" },
  ],
  string: [
    { regex: /\\(?:x[0-9a-fA-F]{2}|u\{[0-9a-fA-F]+\}|.)/, token: "escape" },
    { regex: /"/, token: "string", pop: true },
    { regex: /[^"\\]+/, token: "string" },
    { regex: /.*/, token: "string", pop: true },
  ],
  languageData: {
    name: "zig",
    commentTokens: { line: "//" },
    closeBrackets: { brackets: ["(", "[", "{", "'", '"'] },
  },
});
