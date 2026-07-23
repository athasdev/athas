import { describe, expect, it } from "vitest";
import { normalizePlainTextFence } from "@/features/ai/lib/assistant-markdown";

describe("assistant markdown normalization", () => {
  it("unwraps prose emitted inside a plain text fence", () => {
    const warning =
      "```\nModel metadata for `gpt-5.6-sol` not found. Defaulting to fallback metadata; this can degrade performance and cause issues.\n```";

    expect(normalizePlainTextFence(warning)).toBe(
      "Model metadata for `gpt-5.6-sol` not found. Defaulting to fallback metadata; this can degrade performance and cause issues.",
    );
  });

  it("preserves fenced source code", () => {
    const code = "```ts\nconst answer = 42;\n```";

    expect(normalizePlainTextFence(code)).toBe(code);
  });
});
