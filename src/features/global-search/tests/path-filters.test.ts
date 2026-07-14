import { describe, expect, it } from "vite-plus/test";
import { createPathFilterPredicate, matchesPathFilters } from "../utils/path-filters";

describe("global search path filters", () => {
  it("matches any include pattern and rejects excluded paths", () => {
    const matches = createPathFilterPredicate(
      "/project",
      "src/**/*.ts, tests/**/*.tsx",
      "fixtures, *.generated.ts",
    );

    expect(matches("/project/src/features/search/index.ts")).toBe(true);
    expect(matches("/project/tests/search/index.test.tsx")).toBe(true);
    expect(matches("/project/src/fixtures/index.ts")).toBe(false);
    expect(matches("/project/src/types.generated.ts")).toBe(false);
    expect(matches("/project/README.md")).toBe(false);
  });

  it("treats plain filters as case-insensitive path fragments", () => {
    expect(matchesPathFilters("/project/SRC/Search/File.ts", "/project", "search", "")).toBe(true);
    expect(matchesPathFilters("/project/src/file.ts", "/project", "", "SRC")).toBe(false);
  });

  it("supports newline-separated filters", () => {
    const matches = createPathFilterPredicate("/project", "*.rs\n*.toml", "target");

    expect(matches("/project/src/main.rs")).toBe(true);
    expect(matches("/project/Cargo.toml")).toBe(true);
    expect(matches("/project/target/generated.rs")).toBe(false);
  });
});
