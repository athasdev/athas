import { describe, expect, it } from "vite-plus/test";
import {
  getLanguageDisplayName as getAthasEditorLanguageDisplayName,
  getLanguageIdFromPath as getAthasEditorLanguageIdFromPath,
} from "@/features/editor/utils/language-id";
import { detectLanguageFromFileName } from "../utils/language-detection";
import { getLanguageDisplayName, getLanguageIdFromPath } from "../utils/language-id";
import { isMarkdownFile as isEditorMarkdownFile } from "../utils/lines";
import {
  hasLineBasedSyntaxFallback,
  hasLineBasedSyntaxHighlighter,
  tokenizeLineBasedSyntax,
} from "../utils/line-based-syntax";
import {
  MONACO_HIGHLIGHT_LANGUAGE_IDS,
  MONACO_LANGUAGE_BY_ATHAS_ID,
  toMonacoLanguageId,
} from "../monaco/language";
import { getLanguageOverlayTokens } from "../lib/wasm-parser/language-overlays";

describe("getLanguageIdFromPath", () => {
  it("detects scm files as scheme", () => {
    expect(getLanguageIdFromPath("/tmp/highlights.scm")).toBe("scheme");
  });

  it("detects nix files", () => {
    expect(getLanguageIdFromPath("/tmp/flake.nix")).toBe("nix");
  });

  it("detects Angular component templates", () => {
    expect(getLanguageIdFromPath("/tmp/src/app/app.component.html")).toBe("angular");
    expect(getLanguageIdFromPath("/tmp/src/app/app.ng.html")).toBe("angular");
  });

  it("keeps regular html files as html", () => {
    expect(getLanguageIdFromPath("/tmp/index.html")).toBe("html");
  });

  it("detects dotenv files", () => {
    expect(getLanguageIdFromPath("/tmp/.env")).toBe("dotenv");
    expect(getLanguageIdFromPath("/tmp/.env.local")).toBe("dotenv");
    expect(getLanguageIdFromPath("/tmp/.env.production.local")).toBe("dotenv");
    expect(getLanguageDisplayName("dotenv")).toBe("Dotenv");
  });

  it("detects extension-backed highlight languages without registry data", () => {
    expect(getLanguageIdFromPath("/tmp/component.tsx")).toBe("typescriptreact");
    expect(getLanguageIdFromPath("/tmp/analysis.R")).toBe("r");
    expect(getLanguageIdFromPath("/tmp/.Rprofile")).toBe("r");
    expect(getLanguageIdFromPath("/tmp/exploration.ipy")).toBe("python");
    expect(getLanguageIdFromPath("/tmp/report.Rmd")).toBe("rmarkdown");
    expect(getLanguageIdFromPath("/tmp/notebook.ipynb")).toBe("jupyter-notebook");
    expect(getLanguageIdFromPath("/tmp/styles.scss")).toBe("scss");
    expect(getLanguageIdFromPath("/tmp/Dockerfile")).toBe("dockerfile");
    expect(getLanguageIdFromPath("/tmp/.gitignore")).toBe("gitignore");
    expect(getLanguageIdFromPath("/tmp/.dockerignore")).toBe("gitignore");
    expect(getLanguageIdFromPath("/tmp/.npmignore")).toBe("gitignore");
    expect(getLanguageIdFromPath("/tmp/.gitattributes")).toBe("gitattributes");
    expect(getLanguageIdFromPath("/tmp/.git/info/exclude")).toBe("gitignore");
    expect(getLanguageIdFromPath("/tmp/.git/info/attributes")).toBe("gitattributes");
    expect(getLanguageIdFromPath("/tmp/example.diff")).toBe("diff");
    expect(getLanguageIdFromPath("/tmp/example.patch")).toBe("diff");
    expect(getLanguageIdFromPath("/tmp/bun.lock")).toBe("lockfile");
    expect(getLanguageIdFromPath("/tmp/main.zig")).toBe("zig");
    expect(getLanguageIdFromPath("/tmp/Main.elm")).toBe("elm");
    expect(getLanguageIdFromPath("/tmp/init.el")).toBe("elisp");
    expect(getLanguageIdFromPath("/tmp/schema.graphql")).toBe("graphql");
    expect(getLanguageIdFromPath("/tmp/message.proto")).toBe("protobuf");
    expect(getLanguageIdFromPath("/tmp/query.ql")).toBe("ql");
    expect(getLanguageIdFromPath("/tmp/main.tf")).toBe("terraform");
    expect(getLanguageIdFromPath("/tmp/icon.svg")).toBe("xml");
    expect(getLanguageIdFromPath("/tmp/project.csproj")).toBe("xml");
    expect(getLanguageDisplayName("diff")).toBe("Diff");
    expect(getLanguageDisplayName("gitignore")).toBe("Git Ignore");
    expect(getLanguageDisplayName("gitattributes")).toBe("Git Attributes");
    expect(getLanguageDisplayName("elisp")).toBe("Emacs Lisp");
    expect(getLanguageDisplayName("lockfile")).toBe("Lockfile");
    expect(getLanguageDisplayName("r")).toBe("R");
    expect(getLanguageDisplayName("rmarkdown")).toBe("R Markdown");
    expect(getLanguageDisplayName("jupyter-notebook")).toBe("Jupyter Notebook");
  });

  it("maps Monaco-highlighted extensions to registered Monaco language ids", () => {
    expect(toMonacoLanguageId(getLanguageIdFromPath("/tmp/component.tsx"))).toBe("typescript");
    expect(toMonacoLanguageId(getLanguageIdFromPath("/tmp/exploration.ipy"))).toBe("python");
    expect(toMonacoLanguageId(getLanguageIdFromPath("/tmp/analysis.R"))).toBe("r");
    expect(toMonacoLanguageId(getLanguageIdFromPath("/tmp/report.Rmd"))).toBe("markdown");
    expect(toMonacoLanguageId(getLanguageIdFromPath("/tmp/notebook.ipynb"))).toBe("json");
    expect(toMonacoLanguageId(getLanguageIdFromPath("/tmp/.gitignore"))).toBe("gitignore");
    expect(toMonacoLanguageId(getLanguageIdFromPath("/tmp/.dockerignore"))).toBe("gitignore");
    expect(toMonacoLanguageId(getLanguageIdFromPath("/tmp/.gitattributes"))).toBe("gitattributes");
    expect(toMonacoLanguageId(getLanguageIdFromPath("/tmp/bun.lock"))).toBe("lockfile");
    expect(toMonacoLanguageId(getLanguageIdFromPath("/tmp/main.zig"))).toBe("zig");
    expect(toMonacoLanguageId(getLanguageIdFromPath("/tmp/Main.elm"))).toBe("elm");
    expect(toMonacoLanguageId(getLanguageIdFromPath("/tmp/init.el"))).toBe("elisp");
  });
});

describe("toMonacoLanguageId", () => {
  it("maps every Monaco-backed Athas language to a bundled highlight contribution", () => {
    for (const [athasLanguageId, monacoLanguageId] of Object.entries(MONACO_LANGUAGE_BY_ATHAS_ID)) {
      if (monacoLanguageId === "plaintext") continue;

      expect(
        MONACO_HIGHLIGHT_LANGUAGE_IDS.has(toMonacoLanguageId(athasLanguageId)),
        `${athasLanguageId} maps to ${monacoLanguageId}`,
      ).toBe(true);
    }
  });
});

describe("Athas editor language detection", () => {
  it("keeps dotfile syntax mappings aligned with the shared editor surface", () => {
    expect(getAthasEditorLanguageIdFromPath("/tmp/.gitignore")).toBe("gitignore");
    expect(getAthasEditorLanguageIdFromPath("/tmp/exploration.ipy")).toBe("python");
    expect(getAthasEditorLanguageIdFromPath("/tmp/analysis.R")).toBe("r");
    expect(getAthasEditorLanguageIdFromPath("/tmp/report.Rmd")).toBe("rmarkdown");
    expect(getAthasEditorLanguageIdFromPath("/tmp/notebook.ipynb")).toBe("jupyter-notebook");
    expect(getAthasEditorLanguageIdFromPath("/tmp/.dockerignore")).toBe("gitignore");
    expect(getAthasEditorLanguageIdFromPath("/tmp/.gitattributes")).toBe("gitattributes");
    expect(getAthasEditorLanguageIdFromPath("/tmp/.git/info/exclude")).toBe("gitignore");
    expect(getAthasEditorLanguageIdFromPath("/tmp/.git/info/attributes")).toBe("gitattributes");
    expect(getAthasEditorLanguageIdFromPath("/tmp/bun.lock")).toBe("lockfile");
    expect(getAthasEditorLanguageDisplayName("gitattributes")).toBe("Git Attributes");
    expect(getAthasEditorLanguageDisplayName("lockfile")).toBe("Lockfile");
    expect(getAthasEditorLanguageDisplayName("rmarkdown")).toBe("R Markdown");
  });
});

describe("Markdown preview file detection", () => {
  it("treats R Markdown as a Markdown-previewable source file", () => {
    expect(isEditorMarkdownFile("/tmp/README.md")).toBe(true);
    expect(isEditorMarkdownFile("/tmp/report.Rmd")).toBe(true);
    expect(isEditorMarkdownFile("/tmp/analysis.R")).toBe(false);
  });
});

describe("R Markdown overlays", () => {
  it("highlights YAML front matter tokens", () => {
    const tokens = getLanguageOverlayTokens(
      "rmarkdown",
      "---\ntitle: Research Report\noutput: html_document\n---\n\n```{r}\nsummary(cars)\n```",
    );

    expect(tokens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "token-punctuation" }),
        expect.objectContaining({ type: "token-property" }),
        expect.objectContaining({ type: "token-string" }),
      ]),
    );
  });
});

describe("line-based syntax highlighting", () => {
  it("highlights diff, ignore, attributes, and lockfile syntaxes without a Tree-sitter parser", () => {
    expect(hasLineBasedSyntaxHighlighter("diff")).toBe(true);
    expect(hasLineBasedSyntaxHighlighter("gitignore")).toBe(true);
    expect(hasLineBasedSyntaxHighlighter("gitattributes")).toBe(true);
    expect(hasLineBasedSyntaxHighlighter("lockfile")).toBe(true);

    expect(
      tokenizeLineBasedSyntax(
        "diff --git a/src/file.ts b/src/file.ts\n@@ -1 +1 @@\n-old\n+new",
        "diff",
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ class_name: "token-keyword" }),
        expect.objectContaining({ class_name: "token-attribute" }),
        expect.objectContaining({ class_name: "token-variable" }),
        expect.objectContaining({ class_name: "token-string" }),
      ]),
    );
    expect(tokenizeLineBasedSyntax("# comment\n!important/*.log", "gitignore")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ class_name: "token-comment" }),
        expect.objectContaining({ class_name: "token-keyword" }),
        expect.objectContaining({ class_name: "token-operator" }),
      ]),
    );
    expect(tokenizeLineBasedSyntax("*.png filter=lfs -diff", "gitattributes")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ class_name: "token-string" }),
        expect.objectContaining({ class_name: "token-property" }),
        expect.objectContaining({ class_name: "token-operator" }),
      ]),
    );
    expect(tokenizeLineBasedSyntax('"pkg": ["1.0.0", true]', "lockfile")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ class_name: "token-property" }),
        expect.objectContaining({ class_name: "token-string" }),
        expect.objectContaining({ class_name: "token-constant" }),
      ]),
    );
  });

  it("provides fallback tokens for reported parser-backed languages", () => {
    for (const languageId of ["typescriptreact", "zig", "elm", "elisp"]) {
      expect(hasLineBasedSyntaxHighlighter(languageId)).toBe(false);
      expect(hasLineBasedSyntaxFallback(languageId)).toBe(true);
    }

    expect(
      tokenizeLineBasedSyntax(
        'export const View = () => <div className="root" />',
        "typescriptreact",
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ class_name: "token-keyword" }),
        expect.objectContaining({ class_name: "token-tag" }),
        expect.objectContaining({ class_name: "token-attribute" }),
      ]),
    );
    expect(tokenizeLineBasedSyntax("pub fn main() void { const n: i32 = 1; }", "zig")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ class_name: "token-keyword" }),
        expect.objectContaining({ class_name: "token-type" }),
        expect.objectContaining({ class_name: "token-number" }),
      ]),
    );
    expect(tokenizeLineBasedSyntax("module Main exposing (main)\nmain = 1", "elm")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ class_name: "token-keyword" }),
        expect.objectContaining({ class_name: "token-type" }),
        expect.objectContaining({ class_name: "token-function" }),
      ]),
    );
    expect(tokenizeLineBasedSyntax('(defun hello () "hi")', "elisp")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ class_name: "token-keyword" }),
        expect.objectContaining({ class_name: "token-string" }),
        expect.objectContaining({ class_name: "token-punctuation" }),
      ]),
    );
  });
});

describe("detectLanguageFromFileName", () => {
  it("keeps buffer metadata aligned for Monaco-highlighted extensions", () => {
    expect(detectLanguageFromFileName("component.tsx")).toBe("typescriptreact");
    expect(detectLanguageFromFileName("exploration.ipy")).toBe("python");
    expect(detectLanguageFromFileName("analysis.R")).toBe("r");
    expect(detectLanguageFromFileName(".Rprofile")).toBe("r");
    expect(detectLanguageFromFileName("report.Rmd")).toBe("rmarkdown");
    expect(detectLanguageFromFileName("notebook.ipynb")).toBe("jupyter-notebook");
    expect(detectLanguageFromFileName(".gitignore")).toBe("gitignore");
    expect(detectLanguageFromFileName(".dockerignore")).toBe("gitignore");
    expect(detectLanguageFromFileName(".gitattributes")).toBe("gitattributes");
    expect(detectLanguageFromFileName("bun.lock")).toBe("lockfile");
    expect(detectLanguageFromFileName("main.zig")).toBe("zig");
    expect(detectLanguageFromFileName("Main.elm")).toBe("elm");
    expect(detectLanguageFromFileName("init.el")).toBe("elisp");
  });
});
