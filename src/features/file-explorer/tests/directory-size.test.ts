import { describe, expect, it } from "vitest";
import type { FileEntry } from "@/features/file-system/types/app.types";
import { shouldShowDirectorySize } from "../hooks/use-directory-size";

function directory(name: string, options: Partial<FileEntry> = {}): FileEntry {
  return {
    name,
    path: `/project/${name}`,
    isDir: true,
    ...options,
  };
}

describe("shouldShowDirectorySize", () => {
  it("includes dot-prefixed and ignored directories", () => {
    expect(shouldShowDirectorySize(directory(".cache"))).toBe(true);
    expect(shouldShowDirectorySize(directory("node_modules", { ignored: true }))).toBe(true);
    expect(shouldShowDirectorySize(directory("target", { ignored: true }))).toBe(true);
  });

  it("excludes regular directories and files", () => {
    expect(shouldShowDirectorySize(directory("src"))).toBe(false);
    expect(
      shouldShowDirectorySize({
        name: ".env",
        path: "/project/.env",
        isDir: false,
      }),
    ).toBe(false);
  });

  it("excludes directory providers without recursive size support", () => {
    expect(
      shouldShowDirectorySize(directory(".cache", { path: "remote://server/project/.cache" })),
    ).toBe(false);
    expect(
      shouldShowDirectorySize(directory("target", { path: "wsl://Ubuntu/project/target" })),
    ).toBe(false);
  });
});
