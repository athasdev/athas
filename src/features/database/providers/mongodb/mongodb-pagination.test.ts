import { describe, expect, it } from "vite-plus/test";
import { getMongoDocumentDisplayIndex } from "./mongodb-pagination";

describe("mongodb pagination", () => {
  it("returns document display indexes relative to the full result set", () => {
    expect(getMongoDocumentDisplayIndex(1, 25, 0)).toBe(1);
    expect(getMongoDocumentDisplayIndex(3, 25, 0)).toBe(51);
    expect(getMongoDocumentDisplayIndex(3, 25, 4)).toBe(55);
  });

  it("normalizes invalid pagination inputs", () => {
    expect(getMongoDocumentDisplayIndex(0, 0, -1)).toBe(1);
    expect(getMongoDocumentDisplayIndex(Number.NaN, Number.NaN, Number.NaN)).toBe(1);
  });
});
