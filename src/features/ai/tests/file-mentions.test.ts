import { describe, expect, it } from "vite-plus/test";
import { appendReferencedFiles, extractFileMentionNames } from "../lib/file-mentions";

describe("file mentions", () => {
  it("extracts multiple composer tokens without merging adjacent context", () => {
    expect(extractFileMentionNames("@[01-bug.yml] @[03-enhancement.yml] follow up")).toEqual([
      "01-bug.yml",
      "03-enhancement.yml",
    ]);
  });

  it("supports file names with spaces and legacy unbracketed mentions", () => {
    expect(extractFileMentionNames("@[release notes.md] @README.md")).toEqual([
      "release notes.md",
      "README.md",
    ]);
  });

  it("appends selected file contents to provider messages", () => {
    expect(
      appendReferencedFiles("Review this", [
        {
          name: "app.ts",
          path: "/workspace/app.ts",
          content: "export const ready = true;",
        },
      ]),
    ).toContain("### app.ts (/workspace/app.ts)\n```\nexport const ready = true;\n```");
  });
});
