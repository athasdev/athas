import { LanguageSupport, StreamLanguage, type StreamParser } from "@codemirror/language";
import type { Extension } from "@codemirror/state";

type LanguageLoader = () => Promise<Extension>;

const legacy =
  <T>(load: () => Promise<StreamParser<T>>): LanguageLoader =>
  () =>
    load().then((parser) => StreamLanguage.define(parser));

const javascript = (options: { typescript?: boolean; jsx?: boolean }) => () =>
  import("@codemirror/lang-javascript").then((m) => m.javascript(options));
const html = () => import("@codemirror/lang-html").then((m) => m.html());
const markdown = () =>
  import("@codemirror/lang-markdown").then(async (m) => {
    const { languages } = await import("./language-data");
    return m.markdown({ codeLanguages: languages });
  });

/** Athas language ids, as `getLanguageIdFromPath` returns them, mapped to CodeMirror support. */
const LANGUAGE_LOADERS: Record<string, LanguageLoader> = {
  javascript: javascript({}),
  javascriptreact: javascript({ jsx: true }),
  typescript: javascript({ typescript: true }),
  typescriptreact: javascript({ typescript: true, jsx: true }),
  rescript: javascript({}),
  python: () => import("@codemirror/lang-python").then((m) => m.python()),
  rust: () => import("@codemirror/lang-rust").then((m) => m.rust()),
  html,
  svelte: html,
  astro: html,
  css: () => import("@codemirror/lang-css").then((m) => m.css()),
  scss: () => import("@codemirror/lang-sass").then((m) => m.sass()),
  sass: () => import("@codemirror/lang-sass").then((m) => m.sass({ indented: true })),
  less: () => import("@codemirror/lang-less").then((m) => m.less()),
  json: () => import("@codemirror/lang-json").then((m) => m.json()),
  jsonc: () => import("@codemirror/lang-json").then((m) => m.json()),
  "jupyter-notebook": () => import("@codemirror/lang-json").then((m) => m.json()),
  markdown,
  mdx: markdown,
  rmarkdown: markdown,
  rmd: markdown,
  go: () => import("@codemirror/lang-go").then((m) => m.go()),
  c: () => import("@codemirror/lang-cpp").then((m) => m.cpp()),
  cpp: () => import("@codemirror/lang-cpp").then((m) => m.cpp()),
  java: () => import("@codemirror/lang-java").then((m) => m.java()),
  php: () => import("@codemirror/lang-php").then((m) => m.php()),
  sql: () => import("@codemirror/lang-sql").then((m) => m.sql()),
  ql: () => import("@codemirror/lang-sql").then((m) => m.sql()),
  yaml: () => import("@codemirror/lang-yaml").then((m) => m.yaml()),
  xml: () => import("@codemirror/lang-xml").then((m) => m.xml()),
  vue: () => import("@codemirror/lang-vue").then((m) => m.vue()),
  angular: () => import("@codemirror/lang-angular").then((m) => m.angular()),
  bash: legacy(() => import("@codemirror/legacy-modes/mode/shell").then((m) => m.shell)),
  dotenv: legacy(() => import("@codemirror/legacy-modes/mode/shell").then((m) => m.shell)),
  dockerfile: legacy(() =>
    import("@codemirror/legacy-modes/mode/dockerfile").then((m) => m.dockerFile),
  ),
  ruby: legacy(() => import("@codemirror/legacy-modes/mode/ruby").then((m) => m.ruby)),
  lua: legacy(() => import("@codemirror/legacy-modes/mode/lua").then((m) => m.lua)),
  swift: legacy(() => import("@codemirror/legacy-modes/mode/swift").then((m) => m.swift)),
  kotlin: legacy(() => import("@codemirror/legacy-modes/mode/clike").then((m) => m.kotlin)),
  scala: legacy(() => import("@codemirror/legacy-modes/mode/clike").then((m) => m.scala)),
  csharp: legacy(() => import("@codemirror/legacy-modes/mode/clike").then((m) => m.csharp)),
  objc: legacy(() => import("@codemirror/legacy-modes/mode/clike").then((m) => m.objectiveC)),
  dart: legacy(() => import("@codemirror/legacy-modes/mode/clike").then((m) => m.dart)),
  toml: legacy(() => import("@codemirror/legacy-modes/mode/toml").then((m) => m.toml)),
  diff: legacy(() => import("@codemirror/legacy-modes/mode/diff").then((m) => m.diff)),
  r: legacy(() => import("@codemirror/legacy-modes/mode/r").then((m) => m.r)),
  elm: legacy(() => import("@codemirror/legacy-modes/mode/elm").then((m) => m.elm)),
  scheme: legacy(() => import("@codemirror/legacy-modes/mode/scheme").then((m) => m.scheme)),
  elisp: legacy(() => import("@codemirror/legacy-modes/mode/commonlisp").then((m) => m.commonLisp)),
  ocaml: legacy(() => import("@codemirror/legacy-modes/mode/mllike").then((m) => m.oCaml)),
  protobuf: legacy(() => import("@codemirror/legacy-modes/mode/protobuf").then((m) => m.protobuf)),
  gitignore: legacy(() =>
    import("@codemirror/legacy-modes/mode/properties").then((m) => m.properties),
  ),
  gitattributes: legacy(() =>
    import("@codemirror/legacy-modes/mode/properties").then((m) => m.properties),
  ),
};

const loaded = new Map<string, Promise<Extension | null>>();

/** Whether CodeMirror has highlighting for an Athas language id. */
export function hasCodeMirrorLanguage(languageId: string | null | undefined) {
  return Boolean(languageId && LANGUAGE_LOADERS[languageId]);
}

/**
 * The CodeMirror language for an Athas language id, loaded once and shared by every editor.
 * Resolves to null for languages without CodeMirror support, which then show as plain text.
 */
export function loadCodeMirrorLanguage(
  languageId: string | null | undefined,
): Promise<Extension | null> {
  const loader = languageId ? LANGUAGE_LOADERS[languageId] : undefined;
  if (!languageId || !loader) return Promise.resolve(null);
  let promise = loaded.get(languageId);
  if (!promise) {
    promise = loader().catch((error: unknown) => {
      loaded.delete(languageId);
      console.error(`Failed to load the ${languageId} language:`, error);
      return null;
    });
    loaded.set(languageId, promise);
  }
  return promise;
}

export type { LanguageSupport };
