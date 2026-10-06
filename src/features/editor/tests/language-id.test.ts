import { describe, expect, it } from "vite-plus/test";
import { detectLanguageFromFileName } from "../utils/language-detection";
import { getLanguageDisplayName, getLanguageIdFromPath } from "../utils/language-id";
import { isMarkdownFile as isEditorMarkdownFile } from "../utils/lines";
import { hasCodeMirrorLanguage } from "../engines/codemirror/languages";

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
    expect(getLanguageIdFromPath("/tmp/page.astro")).toBe("astro");
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
    expect(getLanguageDisplayName("astro")).toBe("Astro");
  });

  it("resolves highlighted files to a CodeMirror language", () => {
    for (const path of [
      "/tmp/component.tsx",
      "/tmp/exploration.ipy",
      "/tmp/analysis.R",
      "/tmp/report.Rmd",
      "/tmp/notebook.ipynb",
      "/tmp/.gitignore",
      "/tmp/.dockerignore",
      "/tmp/.gitattributes",
      "/tmp/bun.lock",
      "/tmp/flake.nix",
      "/tmp/main.zig",
      "/tmp/Main.elm",
      "/tmp/init.el",
      "/tmp/Makefile",
      "/tmp/Dockerfile.dev",
    ]) {
      expect(hasCodeMirrorLanguage(getLanguageIdFromPath(path) ?? ""), path).toBe(true);
    }
  });
});

describe("Markdown preview file detection", () => {
  it("treats R Markdown as a Markdown-previewable source file", () => {
    expect(isEditorMarkdownFile("/tmp/README.md")).toBe(true);
    expect(isEditorMarkdownFile("/tmp/report.Rmd")).toBe(true);
    expect(isEditorMarkdownFile("/tmp/analysis.R")).toBe(false);
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
