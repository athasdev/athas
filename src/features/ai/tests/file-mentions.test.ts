import { describe, expect, it } from "vite-plus/test";
import { extractFileMentionNames } from "../lib/file-mentions";

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
});
