import { describe, expect, it } from "vitest";
import { redactLocalPaths } from "../services/shareable-outcome";

describe("redactLocalPaths", () => {
  it("redacts local absolute paths", () => {
    const text = redactLocalPaths(
      "Implemented the fix in `/Users/alex/secret/src/app.ts` and C:\\work\\private\\app.ts.",
    );

    expect(text).toBe("Implemented the fix in `[local path]` and [local path]");
    expect(text).not.toContain("secret");
    expect(text).not.toContain("private");
  });

  it("preserves relative implementation details", () => {
    expect(redactLocalPaths("Updated `src/app.ts`.\n\nTests pass.")).toBe(
      "Updated `src/app.ts`.\n\nTests pass.",
    );
  });
});
