import { describe, expect, it } from "vite-plus/test";
import {
  areProjectTabPathsEqual,
  createProjectTabId,
  normalizeProjectTabPath,
} from "../utils/project-tab-path";

describe("project tab path identity", () => {
  it("trims and strips trailing path separators", () => {
    expect(normalizeProjectTabPath(" /Users/me/project/// ")).toBe("/Users/me/project");
  });

  it("keeps filesystem roots intact", () => {
    expect(normalizeProjectTabPath("/")).toBe("/");
    expect(normalizeProjectTabPath("C:\\")).toBe("C:\\");
  });

  it("matches local paths that only differ by trailing separators", () => {
    expect(areProjectTabPathsEqual("/Users/me/project", "/Users/me/project/")).toBe(true);
  });

  it("preserves case sensitivity for unix-style paths", () => {
    expect(areProjectTabPathsEqual("/Users/me/Project", "/Users/me/project")).toBe(false);
  });

  it("matches windows drive paths case-insensitively", () => {
    expect(areProjectTabPathsEqual("C:\\Users\\Me\\Project", "c:/users/me/project/")).toBe(true);
  });

  it("creates stable project IDs from normalized paths", () => {
    expect(createProjectTabId("/Users/me/project")).toBe(createProjectTabId("/Users/me/project/"));
    expect(createProjectTabId("/Users/me/project")).toMatch(/^project-[a-z0-9]+$/);
  });
});
