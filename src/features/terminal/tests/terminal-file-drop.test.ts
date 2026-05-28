import { describe, expect, it } from "vite-plus/test";
import { formatDroppedPathsForTerminal } from "../utils/terminal-file-drop";

describe("formatDroppedPathsForTerminal", () => {
  it("formats dropped paths for insertion into a shell prompt", () => {
    expect(
      formatDroppedPathsForTerminal([
        "file:///Users/test/My%20Image.png",
        "/Users/test/project/file.ts",
      ]),
    ).toBe('"/Users/test/My Image.png" /Users/test/project/file.ts ');
  });

  it("drops unsupported payload entries", () => {
    expect(formatDroppedPathsForTerminal(["https://athas.dev", "relative/path.ts"])).toBe("");
  });
});
