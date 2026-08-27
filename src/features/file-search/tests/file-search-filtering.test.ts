import { describe, expect, it } from "vite-plus/test";
import { shouldIgnoreSearchEntry, shouldIgnoreSearchFile } from "../utils/file-search-filtering";

describe("file search filtering", () => {
  it("shares directory and file exclusions across search surfaces", () => {
    expect(shouldIgnoreSearchEntry("node_modules", true)).toBe(true);
    expect(shouldIgnoreSearchEntry("src", true)).toBe(false);
    expect(shouldIgnoreSearchEntry("Cargo.lock", false)).toBe(true);
    expect(shouldIgnoreSearchEntry("main.rs", false)).toBe(false);
  });

  it("rejects ignored directories and extensions from full paths", () => {
    expect(shouldIgnoreSearchFile("/workspace/node_modules/pkg/index.ts")).toBe(true);
    expect(shouldIgnoreSearchFile("/workspace/src/app.min.js")).toBe(true);
    expect(shouldIgnoreSearchFile("/workspace/src/app.ts")).toBe(false);
  });
});
