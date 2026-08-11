import { describe, expect, it } from "vite-plus/test";
import { toMonacoColor, toMonacoTokenForeground } from "../engines/monaco/color";

describe("Monaco colors", () => {
  it("normalizes short hex colors including alpha", () => {
    expect(toMonacoColor("#abc", "#000000")).toBe("#aabbccff");
    expect(toMonacoColor("#abcd", "#000000")).toBe("#aabbccdd");
  });

  it("converts rgb and rgba colors to Monaco hex", () => {
    expect(toMonacoColor("rgb(8, 119, 193)", "#000000")).toBe("#0877c1ff");
    expect(toMonacoColor("rgba(8, 119, 193, 0.2)", "#000000")).toBe("#0877c133");
  });

  it("uses fallbacks and rejects unsupported token colors", () => {
    expect(toMonacoColor("not-a-color", "#123456")).toBe("#123456");
    expect(toMonacoTokenForeground("not-a-color")).toBeUndefined();
    expect(toMonacoTokenForeground("rgba(34, 136, 68, 0.5)")).toBe("22884480");
  });
});
