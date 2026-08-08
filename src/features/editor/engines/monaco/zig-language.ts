import type { languages } from "monaco-editor";

export const zigMonarchLanguage = {
  tokenizer: {
    root: [
      [/\/\/.*$/, "comment"],
      [/\/\*/, "comment", "@comment"],
      [/"([^"\\]|\\.)*$/, "string.invalid"],
      [/"/, "string", "@string"],
      [/'([^'\\]|\\.)*'/, "string"],
      [
        /\b(addrspace|align|allowzero|and|anyframe|anytype|asm|async|await|break|callconv|catch|comptime|const|continue|defer|else|enum|errdefer|error|export|extern|fn|for|if|inline|linksection|noalias|noinline|nosuspend|opaque|or|orelse|packed|pub|resume|return|struct|suspend|switch|test|threadlocal|try|union|unreachable|usingnamespace|var|volatile|while)\b/,
        "keyword",
      ],
      [/\b(true|false|null|undefined)\b/, "constant"],
      [
        /\b[ui](8|16|32|64|128|size)\b|\b(f16|f32|f64|f80|f128|bool|void|noreturn|type|anyerror|comptime_int|comptime_float)\b/,
        "type",
      ],
      [/@[A-Za-z_][\w]*/, "function.builtin"],
      [/\b0x[0-9a-fA-F_]+\b|\b\d[\d_]*(\.\d[\d_]*)?\b/, "number"],
      [/(\.)([A-Za-z_]\w*)(?=\s*\()/, ["delimiter", "function.method.call"]],
      [/(\.)([A-Z][A-Za-z0-9_]*)/, ["delimiter", "type.identifier"]],
      [/(\.)([A-Za-z_]\w*)/, ["delimiter", "property"]],
      [/\b[A-Za-z_]\w*(?=\s*\()/, "function.call"],
      [/\b[A-Za-z_]\w*(?=\s*:)/, "variable.parameter"],
      [/\b[A-Z][A-Za-z0-9_]*\b/, "type.identifier"],
      [/[A-Za-z_]\w*/, "identifier"],
      [/==|!=|<=|>=|=>|<<|>>|\+%|-%|\*%|\+\||-\||\*\||\*\*|[-+*/%=&|^!<>?:~]+/, "operator"],
      [/[{}[\]();,.]/, "delimiter"],
    ],
    comment: [
      [/[^*/]+/, "comment"],
      [/\*\//, "comment", "@pop"],
      [/[*/]/, "comment"],
    ],
    string: [
      [/[^\\"]+/, "string"],
      [/\\./, "string.escape"],
      [/"/, "string", "@pop"],
    ],
  },
} satisfies languages.IMonarchLanguage;
