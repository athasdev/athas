import { describe, expect, it } from "vite-plus/test";
import {
  getNextWordOffset,
  getPreviousWordOffset,
  getWordRangeAtOffset,
} from "../utils/word-navigation";

describe("word navigation", () => {
  it("moves to previous word starts", () => {
    const content = "alpha beta_two + gamma";

    expect(getPreviousWordOffset(content, content.length)).toBe(content.indexOf("gamma"));
    expect(getPreviousWordOffset(content, content.indexOf("beta_two") + 4)).toBe(
      content.indexOf("beta_two"),
    );
    expect(getPreviousWordOffset(content, 0)).toBe(0);
  });

  it("moves to next word starts", () => {
    const content = "alpha beta_two + gamma";

    expect(getNextWordOffset(content, 0)).toBe(content.indexOf("beta_two"));
    expect(getNextWordOffset(content, content.indexOf("beta_two"))).toBe(content.indexOf("gamma"));
    expect(getNextWordOffset(content, content.length)).toBe(content.length);
  });

  it("selects word ranges at or directly after a word", () => {
    const content = "alpha beta_two + gamma";

    expect(getWordRangeAtOffset(content, content.indexOf("beta_two") + 4)).toEqual({
      start: content.indexOf("beta_two"),
      end: content.indexOf("beta_two") + "beta_two".length,
    });
    expect(getWordRangeAtOffset(content, content.indexOf("alpha") + "alpha".length)).toEqual({
      start: 0,
      end: "alpha".length,
    });
    expect(getWordRangeAtOffset(content, content.indexOf("+"))).toBeNull();
  });
});
