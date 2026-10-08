import { describe, expect, it } from "vite-plus/test";
import { matchQuickOpenPrefix } from "../constants/quick-open-sections";
import { toTextMatches } from "../sections/use-text-section";

describe("quick open sections", () => {
  it("jumps to a section from its prefix and keeps the rest of the query", () => {
    expect(matchQuickOpenPrefix("@ render")).toEqual({ section: "symbols", query: "render" });
    expect(matchQuickOpenPrefix("#Store")).toEqual({ section: "symbols", query: "Store" });
    expect(matchQuickOpenPrefix("%todo")).toEqual({ section: "text", query: "todo" });
    expect(matchQuickOpenPrefix("main.ts")).toBeNull();
    // Commands live in the command palette, not here.
    expect(matchQuickOpenPrefix(">toggle")).toBeNull();
  });

  it("cuts long lines so the match stays visible and opens at a 1-based column", () => {
    const line = `    ${"x".repeat(80)} needle`;
    const [match] = toTextMatches(
      [
        {
          file_path: "/repo/a.ts",
          total_matches: 1,
          matches: [{ line_number: 7, line_content: line, column_start: 85, column_end: 91 }],
        },
      ],
      10,
    );
    expect(match?.line).toBe(7);
    expect(match?.column).toBe(86);
    expect(match?.excerpt.startsWith("…")).toBe(true);
    expect(match?.excerpt.endsWith("needle")).toBe(true);
  });
});
