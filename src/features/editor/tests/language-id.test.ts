import { describe, expect, it } from "vite-plus/test";
import {
  getLanguageDisplayName as getAthasEditorLanguageDisplayName,
  getLanguageIdFromPath as getAthasEditorLanguageIdFromPath,
} from "@/features/athas-editor/utils/language-id";
import { detectLanguageFromFileName } from "../utils/language-detection";
import { getLanguageDisplayName, getLanguageIdFromPath } from "../utils/language-id";
import { hasLineBasedSyntaxHighlighter, tokenizeLineBasedSyntax } from "../utils/line-based-syntax";
import {
  MONACO_HIGHLIGHT_LANGUAGE_IDS,
  MONACO_LANGUAGE_BY_ATHAS_ID,
  toMonacoLanguageId,
} from "../monaco/language";

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
  });

  it("maps Monaco-highlighted extensions to registered Monaco language ids", () => {
    expect(toMonacoLanguageId(getLanguageIdFromPath("/tmp/component.tsx"))).toBe("typescript");
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
    expect(getAthasEditorLanguageIdFromPath("/tmp/.dockerignore")).toBe("gitignore");
    expect(getAthasEditorLanguageIdFromPath("/tmp/.gitattributes")).toBe("gitattributes");
    expect(getAthasEditorLanguageIdFromPath("/tmp/.git/info/exclude")).toBe("gitignore");
    expect(getAthasEditorLanguageIdFromPath("/tmp/.git/info/attributes")).toBe("gitattributes");
    expect(getAthasEditorLanguageIdFromPath("/tmp/bun.lock")).toBe("lockfile");
    expect(getAthasEditorLanguageDisplayName("gitattributes")).toBe("Git Attributes");
    expect(getAthasEditorLanguageDisplayName("lockfile")).toBe("Lockfile");
  });
});

describe("line-based syntax highlighting", () => {
  it("highlights ignore, attributes, and lockfile syntaxes without a Tree-sitter parser", () => {
    expect(hasLineBasedSyntaxHighlighter("gitignore")).toBe(true);
    expect(hasLineBasedSyntaxHighlighter("gitattributes")).toBe(true);
    expect(hasLineBasedSyntaxHighlighter("lockfile")).toBe(true);

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
});

describe("detectLanguageFromFileName", () => {
  it("keeps buffer metadata aligned for Monaco-highlighted extensions", () => {
    expect(detectLanguageFromFileName("component.tsx")).toBe("typescriptreact");
    expect(detectLanguageFromFileName(".gitignore")).toBe("gitignore");
    expect(detectLanguageFromFileName(".dockerignore")).toBe("gitignore");
    expect(detectLanguageFromFileName(".gitattributes")).toBe("gitattributes");
    expect(detectLanguageFromFileName("bun.lock")).toBe("lockfile");
    expect(detectLanguageFromFileName("main.zig")).toBe("zig");
    expect(detectLanguageFromFileName("Main.elm")).toBe("elm");
    expect(detectLanguageFromFileName("init.el")).toBe("elisp");
  });
});
