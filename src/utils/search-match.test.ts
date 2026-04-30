import { describe, expect, it } from "vite-plus/test";
import { matchesSearchQuery, scoreSearchQuery } from "./search-match";

describe("matchesSearchQuery", () => {
  it("matches across separators", () => {
    expect(matchesSearchQuery("prepush", ["pre-push"])).toBe(true);
    expect(matchesSearchQuery("pre-push", ["pre push"])).toBe(true);
    expect(matchesSearchQuery("pre push", ["prePush"])).toBe(true);
  });

  it("matches case and accent insensitive text", () => {
    expect(matchesSearchQuery("istanbul", ["Istanbul"])).toBe(true);
  });

  it("scores weighted matches across separators", () => {
    expect(
      scoreSearchQuery("prepush", [
        { value: "pre-push", weight: 10 },
        { value: "hooks", weight: 1 },
      ]),
    ).toBe(10);
  });
});
