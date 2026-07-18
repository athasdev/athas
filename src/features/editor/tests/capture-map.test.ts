import { describe, expect, it } from "vite-plus/test";
import { isIgnoredCapture, mapCaptureToClass } from "../lib/wasm-parser/capture-map";

describe("capture map", () => {
  it("maps common Tree-sitter captures to distinct editor token classes", () => {
    expect(mapCaptureToClass("keyword.operator")).toBe("token-operator");
    expect(mapCaptureToClass("boolean")).toBe("token-boolean");
    expect(mapCaptureToClass("string.regexp")).toBe("token-regex");
    expect(mapCaptureToClass("string.special.regex")).toBe("token-regex");
    expect(mapCaptureToClass("delimiter")).toBe("token-punctuation");
    expect(mapCaptureToClass("local.function.elm")).toBe("token-function");
  });

  it("ignores metadata captures that should not paint over syntax tokens", () => {
    expect(isIgnoredCapture("spell")).toBe(true);
    expect(isIgnoredCapture("embedded")).toBe(true);
    expect(isIgnoredCapture("_name")).toBe(true);
  });
});
