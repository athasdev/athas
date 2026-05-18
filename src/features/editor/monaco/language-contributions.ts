import { languages } from "monaco-editor";

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

function ensureLanguage(id: string, extensions: string[], aliases: string[]) {
  if (languages.getLanguages().some((language) => language.id === id)) return;
  languages.register({ id, extensions, aliases });
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
