import { describe, expect, it } from "vitest";
import { buildShareableOutcomeMarkdown } from "../lib/shareable-outcome";

describe("shareable agent outcome", () => {
  it("shares only the outcome and redacts local absolute paths", () => {
    const markdown = buildShareableOutcomeMarkdown(
      "Implemented the fix in `/Users/alex/secret/src/app.ts` and C:\\work\\private\\app.ts.",
    );

    expect(markdown).toBe("## Outcome\n\nImplemented the fix in `[local path]` and [local path]\n");
    expect(markdown).not.toContain("secret");
    expect(markdown).not.toContain("private");
  });

  it("preserves relative implementation details", () => {
    expect(buildShareableOutcomeMarkdown("Updated `src/app.ts`.\n\nTests pass.")).toBe(
      "## Outcome\n\nUpdated `src/app.ts`.\n\nTests pass.\n",
    );
  });
});
