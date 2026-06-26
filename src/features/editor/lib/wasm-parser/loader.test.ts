import { describe, expect, it } from "vite-plus/test";
import { getTreeSitterRuntimeAssetPath } from "./loader";

describe("wasm parser loader", () => {
  it("maps web-tree-sitter's runtime wasm request to the bundled runtime asset", () => {
    expect(getTreeSitterRuntimeAssetPath("web-tree-sitter.wasm")).toBe(
      "/tree-sitter/tree-sitter.wasm",
    );
  });

  it("keeps other tree-sitter runtime assets under the public tree-sitter directory", () => {
    expect(getTreeSitterRuntimeAssetPath("tree-sitter.js")).toBe("/tree-sitter/tree-sitter.js");
  });
});
