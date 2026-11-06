import { describe, expect, it } from "vite-plus/test";
import { getFileEntryNameError, parseNewEntryPath } from "../utils/file-entry-name";

describe("file entry names", () => {
  it.each(["", " ", ".", "..", "a/b", "a\\b", " lead", "trail ", "bad\u0000name"])(
    "rejects %j everywhere",
    (name) => {
      expect(getFileEntryNameError(name, "/repo", false)).not.toBeNull();
    },
  );

  it("accepts ordinary, dotted and unicode names", () => {
    for (const name of ["index.ts", ".env", "..hidden", "café.md", "a b.txt"]) {
      expect(getFileEntryNameError(name, "/repo", false)).toBeNull();
    }
  });

  it("applies Windows rules only to local Windows folders", () => {
    for (const name of ["a:b", "what?", "trailing.", "CON", "nul.txt"]) {
      expect(getFileEntryNameError(name, "C:\\repo", true)).not.toBeNull();
      expect(getFileEntryNameError(name, "wsl://Ubuntu/home/me", true)).toBeNull();
      expect(getFileEntryNameError(name, "remote://conn/home", true)).toBeNull();
      expect(getFileEntryNameError(name, "/repo", false)).toBeNull();
    }
  });

  it("splits typed paths into names and refuses to leave the folder", () => {
    expect(parseNewEntryPath("src/utils/math.ts", "/repo", false)).toEqual({
      segments: ["src", "utils", "math.ts"],
    });
    expect(parseNewEntryPath("src\\math.ts", "C:\\repo", true)).toEqual({
      segments: ["src", "math.ts"],
    });
    expect(parseNewEntryPath("../escape.ts", "/repo", false)).toHaveProperty("error");
    expect(parseNewEntryPath("a\\b.ts", "/repo", false)).toHaveProperty("error");
    expect(parseNewEntryPath("  / ", "/repo", false)).toHaveProperty("error");
  });
});
