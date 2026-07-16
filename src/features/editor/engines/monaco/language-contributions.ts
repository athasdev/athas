import { languages, typescript } from "monaco-editor";

import "monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution";
import "monaco-editor/esm/vs/basic-languages/css/css.contribution";
import "monaco-editor/esm/vs/basic-languages/csharp/csharp.contribution";
import "monaco-editor/esm/vs/basic-languages/dart/dart.contribution";
import "monaco-editor/esm/vs/basic-languages/dockerfile/dockerfile.contribution";
import "monaco-editor/esm/vs/basic-languages/elixir/elixir.contribution";
import "monaco-editor/esm/vs/basic-languages/go/go.contribution";
import "monaco-editor/esm/vs/basic-languages/graphql/graphql.contribution";
import "monaco-editor/esm/vs/basic-languages/hcl/hcl.contribution";
import "monaco-editor/esm/vs/basic-languages/html/html.contribution";
import "monaco-editor/esm/vs/basic-languages/java/java.contribution";
import "monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution";
import "monaco-editor/esm/vs/basic-languages/kotlin/kotlin.contribution";
import "monaco-editor/esm/vs/basic-languages/less/less.contribution";
import "monaco-editor/esm/vs/basic-languages/lua/lua.contribution";
import "monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution";
import "monaco-editor/esm/vs/basic-languages/objective-c/objective-c.contribution";
import "monaco-editor/esm/vs/basic-languages/php/php.contribution";
import "monaco-editor/esm/vs/basic-languages/protobuf/protobuf.contribution";
import "monaco-editor/esm/vs/basic-languages/python/python.contribution";
import "monaco-editor/esm/vs/basic-languages/r/r.contribution";
import "monaco-editor/esm/vs/basic-languages/ruby/ruby.contribution";
import "monaco-editor/esm/vs/basic-languages/rust/rust.contribution";
import "monaco-editor/esm/vs/basic-languages/scala/scala.contribution";
import "monaco-editor/esm/vs/basic-languages/scheme/scheme.contribution";
import "monaco-editor/esm/vs/basic-languages/scss/scss.contribution";
import "monaco-editor/esm/vs/basic-languages/shell/shell.contribution";
import "monaco-editor/esm/vs/basic-languages/solidity/solidity.contribution";
import "monaco-editor/esm/vs/basic-languages/sql/sql.contribution";
import "monaco-editor/esm/vs/basic-languages/swift/swift.contribution";
import "monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution";
import "monaco-editor/esm/vs/basic-languages/xml/xml.contribution";
import "monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution";
import "monaco-editor/esm/vs/language/css/monaco.contribution";
import "monaco-editor/esm/vs/language/html/monaco.contribution";
import "monaco-editor/esm/vs/language/json/monaco.contribution";
import "monaco-editor/esm/vs/language/typescript/monaco.contribution";

const jsxCompilerOptions = {
  jsx: typescript.JsxEmit.Preserve,
} satisfies typescript.CompilerOptions;

type MonarchLanguageModule = {
  conf: Parameters<typeof languages.setLanguageConfiguration>[1];
  language: Parameters<typeof languages.setMonarchTokensProvider>[1];
};

const monarchLanguageLoaders: Record<string, () => Promise<MonarchLanguageModule>> = {
  c: () => import("monaco-editor/esm/vs/basic-languages/cpp/cpp"),
  cpp: () => import("monaco-editor/esm/vs/basic-languages/cpp/cpp"),
  css: () => import("monaco-editor/esm/vs/basic-languages/css/css"),
  csharp: () => import("monaco-editor/esm/vs/basic-languages/csharp/csharp"),
  dart: () => import("monaco-editor/esm/vs/basic-languages/dart/dart"),
  dockerfile: () => import("monaco-editor/esm/vs/basic-languages/dockerfile/dockerfile"),
  elixir: () => import("monaco-editor/esm/vs/basic-languages/elixir/elixir"),
  go: () => import("monaco-editor/esm/vs/basic-languages/go/go"),
  graphql: () => import("monaco-editor/esm/vs/basic-languages/graphql/graphql"),
  hcl: () => import("monaco-editor/esm/vs/basic-languages/hcl/hcl"),
  html: () => import("monaco-editor/esm/vs/basic-languages/html/html"),
  java: () => import("monaco-editor/esm/vs/basic-languages/java/java"),
  javascript: () => import("monaco-editor/esm/vs/basic-languages/javascript/javascript"),
  kotlin: () => import("monaco-editor/esm/vs/basic-languages/kotlin/kotlin"),
  less: () => import("monaco-editor/esm/vs/basic-languages/less/less"),
  lua: () => import("monaco-editor/esm/vs/basic-languages/lua/lua"),
  markdown: () => import("monaco-editor/esm/vs/basic-languages/markdown/markdown"),
  "objective-c": () => import("monaco-editor/esm/vs/basic-languages/objective-c/objective-c"),
  php: () => import("monaco-editor/esm/vs/basic-languages/php/php"),
  protobuf: () => import("monaco-editor/esm/vs/basic-languages/protobuf/protobuf"),
  python: () => import("monaco-editor/esm/vs/basic-languages/python/python"),
  r: () => import("monaco-editor/esm/vs/basic-languages/r/r"),
  ruby: () => import("monaco-editor/esm/vs/basic-languages/ruby/ruby"),
  rust: () => import("monaco-editor/esm/vs/basic-languages/rust/rust"),
  scala: () => import("monaco-editor/esm/vs/basic-languages/scala/scala"),
  scheme: () => import("monaco-editor/esm/vs/basic-languages/scheme/scheme"),
  scss: () => import("monaco-editor/esm/vs/basic-languages/scss/scss"),
  shell: () => import("monaco-editor/esm/vs/basic-languages/shell/shell"),
  sol: () => import("monaco-editor/esm/vs/basic-languages/solidity/solidity"),
  sql: () => import("monaco-editor/esm/vs/basic-languages/sql/sql"),
  swift: () => import("monaco-editor/esm/vs/basic-languages/swift/swift"),
  typescript: () => import("monaco-editor/esm/vs/basic-languages/typescript/typescript"),
  xml: () => import("monaco-editor/esm/vs/basic-languages/xml/xml"),
  yaml: () => import("monaco-editor/esm/vs/basic-languages/yaml/yaml"),
};

const monarchLanguagePromises = new Map<string, Promise<boolean>>();

export function ensureMonacoLanguageTokenizer(languageId: string): Promise<boolean> {
  if (languageId === "json") {
    const existing = monarchLanguagePromises.get(languageId);
    if (existing) return existing;

    const promise = import("monaco-editor/esm/vs/language/json/tokenization")
      .then(({ createTokenizationSupport }) => {
        languages.setTokensProvider(languageId, createTokenizationSupport(true));
        return true;
      })
      .catch((error) => {
        monarchLanguagePromises.delete(languageId);
        throw error;
      });
    monarchLanguagePromises.set(languageId, promise);
    return promise;
  }

  const loader = monarchLanguageLoaders[languageId];
  if (!loader) return Promise.resolve(false);

  const existing = monarchLanguagePromises.get(languageId);
  if (existing) return existing;

  const promise = loader()
    .then((module) => {
      languages.setLanguageConfiguration(languageId, module.conf);
      languages.setMonarchTokensProvider(languageId, module.language);
      return true;
    })
    .catch((error) => {
      monarchLanguagePromises.delete(languageId);
      throw error;
    });
  monarchLanguagePromises.set(languageId, promise);
  return promise;
}

const lspOwnedDiagnosticsOptions = {
  noSemanticValidation: true,
  noSuggestionDiagnostics: true,
} satisfies typescript.DiagnosticsOptions;

typescript.typescriptDefaults.setCompilerOptions({
  ...typescript.typescriptDefaults.getCompilerOptions(),
  ...jsxCompilerOptions,
});
typescript.typescriptDefaults.setDiagnosticsOptions(lspOwnedDiagnosticsOptions);

typescript.javascriptDefaults.setCompilerOptions({
  ...typescript.javascriptDefaults.getCompilerOptions(),
  ...jsxCompilerOptions,
});
typescript.javascriptDefaults.setDiagnosticsOptions(lspOwnedDiagnosticsOptions);

function ensureLanguage(id: string, extensions: string[], aliases: string[], filenames?: string[]) {
  if (languages.getLanguages().some((language) => language.id === id)) return;
  languages.register({ id, extensions, aliases, filenames });
}

ensureLanguage("diff", [".diff", ".patch"], ["Diff", "diff", "patch"]);
languages.setMonarchTokensProvider("diff", {
  tokenizer: {
    root: [
      [/^@@.*$/, "keyword"],
      [/^diff --git.*$/, "keyword"],
      [/^index\s.*$/, "comment"],
      [/^---.*$/, "comment"],
      [/^\+\+\+.*$/, "comment"],
      [/^\+.*/, "string"],
      [/^-.*/, "regexp"],
    ],
  },
});

ensureLanguage("r", [".r", ".R"], ["R", "r"], [".Rprofile"]);
ensureLanguage("rmarkdown", [".rmd", ".Rmd"], ["R Markdown", "rmd"]);
ensureLanguage("jupyter-notebook", [".ipynb"], ["Jupyter Notebook", "ipynb"]);

ensureLanguage(
  "gitignore",
  [
    ".gitignore",
    ".dockerignore",
    ".ignore",
    ".npmignore",
    ".eslintignore",
    ".prettierignore",
    ".stylelintignore",
    ".vscodeignore",
    ".rgignore",
    ".fdignore",
  ],
  ["Git Ignore", "gitignore", "ignore"],
  [
    ".gitignore",
    ".dockerignore",
    ".ignore",
    ".npmignore",
    ".eslintignore",
    ".prettierignore",
    ".stylelintignore",
    ".vscodeignore",
    ".rgignore",
    ".fdignore",
  ],
);
languages.setMonarchTokensProvider("gitignore", {
  tokenizer: {
    root: [
      [/^\s*#.*$/, "comment"],
      [/^\s*!/, "keyword"],
      [/\\[# !]/, "string.escape"],
      [/[/?*[\]]/, "operator"],
      [/[^/?*[\]\s]+/, "string"],
    ],
  },
});

ensureLanguage(
  "gitattributes",
  [".gitattributes"],
  ["Git Attributes", "gitattributes"],
  [".gitattributes"],
);
languages.setMonarchTokensProvider("gitattributes", {
  tokenizer: {
    root: [
      [/^\s*#.*$/, "comment"],
      [/^\s*\[attr\][^\s]+/, "attribute"],
      [/^\S+/, "string"],
      [/[!-](?=[A-Za-z0-9_.-])/, "operator"],
      [/[A-Za-z0-9_.-]+(?==)/, "key"],
      [/=/, "operator"],
      [/[A-Za-z0-9_.-]+/, "key"],
    ],
  },
});

ensureLanguage("toml", [".toml"], ["TOML", "toml"]);
languages.setMonarchTokensProvider("toml", {
  tokenizer: {
    root: [
      [/^\s*#.*$/, "comment"],
      [/\[[^\]]+\]/, "type"],
      [/^\s*[A-Za-z0-9_.-]+(?=\s*=)/, "key"],
      [/".*?"/, "string"],
      [/'[^']*'/, "string"],
      [/\b(true|false)\b/, "keyword"],
      [/\b\d+(\.\d+)?\b/, "number"],
    ],
  },
});

ensureLanguage("zig", [".zig"], ["Zig", "zig"]);
languages.setMonarchTokensProvider("zig", {
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
      [/@[A-Za-z_][\w]*/, "keyword"],
      [/\b0x[0-9a-fA-F_]+\b|\b\d[\d_]*(\.\d[\d_]*)?\b/, "number"],
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
});

ensureLanguage("elm", [".elm"], ["Elm", "elm"]);
languages.setMonarchTokensProvider("elm", {
  tokenizer: {
    root: [
      [/--.*$/, "comment"],
      [/\{-/, "comment", "@comment"],
      [/"([^"\\]|\\.)*$/, "string.invalid"],
      [/"/, "string", "@string"],
      [/'([^'\\]|\\.)*'/, "string"],
      [
        /\b(alias|as|case|else|exposing|if|import|in|infix|let|module|of|port|then|type|where)\b/,
        "keyword",
      ],
      [/\b(True|False)\b/, "constant"],
      [/\b[A-Z][\w']*/, "type"],
      [/\b\d+(\.\d+)?\b/, "number"],
    ],
    comment: [
      [/[^{-]+/, "comment"],
      [/\{-/, "comment", "@push"],
      [/-\}/, "comment", "@pop"],
      [/[{-]/, "comment"],
    ],
    string: [
      [/[^\\"]+/, "string"],
      [/\\./, "string.escape"],
      [/"/, "string", "@pop"],
    ],
  },
});

ensureLanguage("elisp", [".el"], ["Emacs Lisp", "elisp"]);
languages.setMonarchTokensProvider("elisp", {
  tokenizer: {
    root: [
      [/;.*/, "comment"],
      [/"([^"\\]|\\.)*$/, "string.invalid"],
      [/"/, "string", "@string"],
      [
        /\b(defun|defmacro|defvar|defcustom|defgroup|defconst|let|let\*|lambda|if|when|unless|cond|pcase|progn|save-excursion|interactive|setq|setq-local|require|provide|use-package)\b/,
        "keyword",
      ],
      [/\b(nil|t)\b/, "constant"],
      [/:[A-Za-z0-9_-]+/, "type"],
      [/\b\d+(\.\d+)?\b/, "number"],
      [/[()'`,#]/, "delimiter"],
    ],
    string: [
      [/[^\\"]+/, "string"],
      [/\\./, "string.escape"],
      [/"/, "string", "@pop"],
    ],
  },
});

ensureLanguage("lockfile", [".lock"], ["Lockfile", "lockfile"]);
languages.setMonarchTokensProvider("lockfile", {
  tokenizer: {
    root: [
      [/^\s*#.*$/, "comment"],
      [/^\s*("[^"]+"|'[^']+'|[^:\s][^:]*)(?=:)/, "key"],
      [/"([^"\\]|\\.)*"/, "string"],
      [/'([^'\\]|\\.)*'/, "string"],
      [/\b(true|false|null)\b/, "constant"],
      [/\b\d+(\.\d+)?\b/, "number"],
      [/[{}[\],:]/, "delimiter"],
    ],
  },
});

ensureLanguage("nix", [".nix"], ["Nix", "nix"]);
languages.setMonarchTokensProvider("nix", {
  tokenizer: {
    root: [
      [/#.*$/, "comment"],
      [/''/, "string", "@indentedString"],
      [/"([^"\\]|\\.)*$/, "string.invalid"],
      [/"/, "string", "@string"],
      [/<[A-Za-z0-9._+:-]+>/, "string"],
      [/\b[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s;"')\]}]+/, "string"],
      [/(?:\.\.?|~)?\/[A-Za-z0-9._+@%=-][A-Za-z0-9._+@%/=-]*/, "string"],
      [/\b(assert|else|if|in|inherit|let|or|rec|then|with)\b/, "keyword"],
      [/\b(true|false|null)\b/, "constant"],
      [
        /\b(abort|baseNameOf|builtins|derivation|derivationStrict|dirOf|fetchGit|fetchMercurial|fetchTarball|fetchTree|fromTOML|import|isNull|map|placeholder|removeAttrs|scopedImport|throw|toString)\b/,
        "function.builtin",
      ],
      [
        /\b(__currentSystem|__currentTime|__langVersion|__nixPath|__nixVersion|__storeDir)\b/,
        "constant.builtin",
      ],
      [/\b\d+(\.\d+)?\b/, "number"],
      [/[A-Za-z_][\w'-]*(?=\s*=)/, "key"],
      [/[A-Za-z_][\w'-]*(?=\s*:)/, "variable.parameter"],
      [/[A-Za-z_][\w'-]*/, "identifier"],
      [/==|!=|<=|>=|&&|\|\||\/\/|\+\+|->|[=!<>+\-*/?@:]+/, "operator"],
      [/[{}[\]();.,]/, "delimiter"],
    ],
    string: [
      [/\$\{/, "delimiter.bracket"],
      [/[^\\"$]+/, "string"],
      [/\\./, "string.escape"],
      [/"/, "string", "@pop"],
      [/./, "string"],
    ],
    indentedString: [
      [/\$\{/, "delimiter.bracket"],
      [/'''/, "string.escape"],
      [/''/, "string", "@pop"],
      [/./, "string"],
    ],
  },
});

ensureLanguage("ocaml", [".ml", ".mli"], ["OCaml", "ocaml"]);
languages.setMonarchTokensProvider("ocaml", {
  tokenizer: {
    root: [
      [/\(\*/, "comment", "@comment"],
      [/"([^"\\]|\\.)*$/, "string.invalid"],
      [/"/, "string", "@string"],
      [
        /\b(let|in|rec|type|module|open|match|with|function|fun|if|then|else|struct|sig|end)\b/,
        "keyword",
      ],
      [/\b(true|false)\b/, "constant"],
      [/\b\d+(\.\d+)?\b/, "number"],
    ],
    comment: [
      [/[^(*]+/, "comment"],
      [/\*\)/, "comment", "@pop"],
      [/[(*)]/, "comment"],
    ],
    string: [
      [/[^\\"]+/, "string"],
      [/\\./, "string.escape"],
      [/"/, "string", "@pop"],
    ],
  },
});
