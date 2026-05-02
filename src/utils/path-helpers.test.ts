import { describe, expect, it } from "vite-plus/test";
import {
  ensureTrailingPathSeparator,
  getBaseName,
  getDirName,
  getFolderName,
  getRelativePath,
  joinPath,
} from "./path-helpers";

describe("path helpers", () => {
  it("preserves Windows separators while joining paths", () => {
    expect(joinPath("D:\\workspace\\project\\test", "1.ts")).toBe(
      "D:\\workspace\\project\\test\\1.ts",
    );
    expect(joinPath("D:\\", "workspace")).toBe("D:\\workspace");
  });

  it("preserves POSIX and remote separators while joining paths", () => {
    expect(joinPath("/Users/me/project", "src", "index.ts")).toBe("/Users/me/project/src/index.ts");
    expect(joinPath("remote://server/home/me/project", "src", "index.ts")).toBe(
      "remote://server/home/me/project/src/index.ts",
    );
  });

  it("extracts names from Windows and POSIX paths", () => {
    expect(getBaseName("D:\\workspace\\project\\test\\1.ts")).toBe("1.ts");
    expect(getFolderName("/Users/me/project/")).toBe("project");
  });

  it("extracts parent directories from Windows and POSIX paths", () => {
    expect(getDirName("D:\\workspace\\project\\test\\1.ts")).toBe("D:\\workspace\\project\\test");
    expect(getDirName("/Users/me/project/src/index.ts")).toBe("/Users/me/project/src");
  });

  it("computes relative paths across separator styles", () => {
    expect(getRelativePath("D:\\workspace\\project\\src\\index.ts", "D:\\workspace\\project")).toBe(
      "src/index.ts",
    );
    expect(getRelativePath("d:\\workspace\\project\\src\\index.ts", "D:\\workspace\\project")).toBe(
      "src/index.ts",
    );
  });

  it("does not treat sibling prefixes as children", () => {
    expect(getRelativePath("/work/project-other/file.ts", "/work/project")).toBe(
      "/work/project-other/file.ts",
    );
  });

  it("adds trailing separators using the path style", () => {
    expect(ensureTrailingPathSeparator("D:\\workspace\\project")).toBe("D:\\workspace\\project\\");
    expect(ensureTrailingPathSeparator("/Users/me/project")).toBe("/Users/me/project/");
  });
});
