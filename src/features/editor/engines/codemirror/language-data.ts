import { LanguageDescription } from "@codemirror/language";

/** Languages for fenced code blocks in Markdown, loaded only when a block uses them. */
export const languages = [
  LanguageDescription.of({
    name: "JavaScript",
    alias: ["js", "jsx", "javascript"],
    load: () => import("@codemirror/lang-javascript").then((m) => m.javascript({ jsx: true })),
  }),
  LanguageDescription.of({
    name: "TypeScript",
    alias: ["ts", "tsx", "typescript"],
    load: () =>
      import("@codemirror/lang-javascript").then((m) =>
        m.javascript({ typescript: true, jsx: true }),
      ),
  }),
  LanguageDescription.of({
    name: "Python",
    alias: ["py", "python"],
    load: () => import("@codemirror/lang-python").then((m) => m.python()),
  }),
  LanguageDescription.of({
    name: "Rust",
    alias: ["rs", "rust"],
    load: () => import("@codemirror/lang-rust").then((m) => m.rust()),
  }),
  LanguageDescription.of({
    name: "JSON",
    alias: ["json", "jsonc"],
    load: () => import("@codemirror/lang-json").then((m) => m.json()),
  }),
  LanguageDescription.of({
    name: "HTML",
    alias: ["html"],
    load: () => import("@codemirror/lang-html").then((m) => m.html()),
  }),
  LanguageDescription.of({
    name: "CSS",
    alias: ["css"],
    load: () => import("@codemirror/lang-css").then((m) => m.css()),
  }),
  LanguageDescription.of({
    name: "Go",
    alias: ["go", "golang"],
    load: () => import("@codemirror/lang-go").then((m) => m.go()),
  }),
  LanguageDescription.of({
    name: "YAML",
    alias: ["yaml", "yml"],
    load: () => import("@codemirror/lang-yaml").then((m) => m.yaml()),
  }),
  LanguageDescription.of({
    name: "SQL",
    alias: ["sql"],
    load: () => import("@codemirror/lang-sql").then((m) => m.sql()),
  }),
];
