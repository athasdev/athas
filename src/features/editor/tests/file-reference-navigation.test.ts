import { describe, expect, it } from "vite-plus/test";
import { getFileReferenceAtPosition } from "../lsp/file-reference-navigation";

describe("file reference navigation", () => {
  it("resolves root-relative HTML asset references from the workspace root", () => {
    const content = '<script type="module" src="/src/main.tsx"></script>';

    expect(
      getFileReferenceAtPosition({
        content,
        sourceFilePath: "/workspace/index.html",
        rootFolderPath: "/workspace",
        line: 0,
        column: content.indexOf("main"),
      }),
    ).toMatchObject({
      rawPath: "/src/main.tsx",
      lookupPath: "/src/main.tsx",
      targetPath: "/workspace/src/main.tsx",
      range: {
        line: 0,
        startColumn: content.indexOf("/src/main.tsx"),
        endColumn: content.indexOf("/src/main.tsx") + "/src/main.tsx".length,
      },
    });
  });

  it("resolves relative references from the current file directory", () => {
    const content = '<link rel="stylesheet" href="../assets/app.css?v=1#theme">';

    expect(
      getFileReferenceAtPosition({
        content,
        sourceFilePath: "/workspace/pages/index.html",
        rootFolderPath: "/workspace",
        line: 0,
        column: content.indexOf("app.css"),
      }),
    ).toMatchObject({
      lookupPath: "../assets/app.css",
      targetPath: "/workspace/assets/app.css",
    });
  });

  it("ignores external and hash-only references", () => {
    const content = '<img src="https://example.com/a.png"><a href="#main">main</a>';

    expect(
      getFileReferenceAtPosition({
        content,
        sourceFilePath: "/workspace/index.html",
        rootFolderPath: "/workspace",
        line: 0,
        column: content.indexOf("example.com"),
      }),
    ).toBeNull();

    expect(
      getFileReferenceAtPosition({
        content,
        sourceFilePath: "/workspace/index.html",
        rootFolderPath: "/workspace",
        line: 0,
        column: content.indexOf("#main"),
      }),
    ).toBeNull();
  });
});
