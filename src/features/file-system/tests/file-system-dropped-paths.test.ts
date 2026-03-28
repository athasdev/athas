import { describe, expect, it } from "vite-plus/test";
import { parseDroppedPathCandidate, parseDroppedPaths } from "../utils/file-system-dropped-paths";

describe("dropped-file-paths", () => {
  it("parses absolute unix and windows paths", () => {
    expect(parseDroppedPathCandidate("/Users/me/project/file.ts")).toBe(
      "/Users/me/project/file.ts",
    );
    expect(parseDroppedPathCandidate("C:\\Users\\Me\\project\\file.ts")).toBe(
      "C:\\Users\\Me\\project\\file.ts",
    );
    expect(parseDroppedPathCandidate("/C:/Users/Me/project/file.ts")).toBe(
      "C:/Users/Me/project/file.ts",
    );
  });

  it("parses file URIs and decodes URL encoding", () => {
    expect(parseDroppedPathCandidate("file:///Users/me/my%20file.ts")).toBe("/Users/me/my file.ts");
    expect(parseDroppedPathCandidate("file:///C:/Users/Me/my%20file.ts")).toBe(
      "C:/Users/Me/my file.ts",
    );
  });

  it("ignores unsupported tokens and comments", () => {
    expect(parseDroppedPathCandidate("relative/path.ts")).toBeNull();
    expect(parseDroppedPathCandidate("# comment")).toBeNull();
    expect(parseDroppedPathCandidate("https://athas.dev")).toBeNull();
  });

  it("parses mixed payload entries and deduplicates paths", () => {
    const paths = parseDroppedPaths([
      "file:///C:/Users/Me/project/file.ts\r\n# comment",
      "C:\\Users\\Me\\project\\file.ts",
      "/Users/me/project/another.ts\n/Users/me/project/another.ts",
    ]);

    expect(paths).toEqual([
      "C:/Users/Me/project/file.ts",
      "C:\\Users\\Me\\project\\file.ts",
      "/Users/me/project/another.ts",
    ]);
  });
});
