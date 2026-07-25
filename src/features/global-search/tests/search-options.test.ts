import { describe, expect, it } from "vite-plus/test";
import { fromSearchOptionValues, toSearchOptionValues } from "../utils/search-options";

describe("global search options", () => {
  it("keeps independent search toggles selected", () => {
    const options = fromSearchOptionValues(["case-sensitive", "regex"]);

    expect(options).toEqual({
      caseSensitive: true,
      wholeWord: false,
      useRegex: true,
    });
    expect(toSearchOptionValues(options)).toEqual(["case-sensitive", "regex"]);
  });

  it("clears only the option removed from the toggle group", () => {
    const current = toSearchOptionValues({
      caseSensitive: true,
      wholeWord: true,
      useRegex: true,
    });
    const next = fromSearchOptionValues(current.filter((value) => value !== "whole-word"));

    expect(next).toEqual({
      caseSensitive: true,
      wholeWord: false,
      useRegex: true,
    });
  });
});
