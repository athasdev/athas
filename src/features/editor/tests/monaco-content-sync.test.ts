import { describe, expect, it } from "vite-plus/test";
import { isExternalModelUpdate, runWithExternalModelUpdate } from "../engines/monaco/content-sync";

describe("Monaco content sync", () => {
  it("marks nested external updates without retaining content snapshots", () => {
    const model = {};
    runWithExternalModelUpdate(model, () => {
      expect(isExternalModelUpdate(model)).toBe(true);
      runWithExternalModelUpdate(model, () => expect(isExternalModelUpdate(model)).toBe(true));
      expect(isExternalModelUpdate(model)).toBe(true);
    });
    expect(isExternalModelUpdate(model)).toBe(false);
  });

  it("clears the marker after an exception", () => {
    const model = {};
    expect(() =>
      runWithExternalModelUpdate(model, () => {
        throw new Error("failed");
      }),
    ).toThrow();
    expect(isExternalModelUpdate(model)).toBe(false);
  });
});
