import { describe, expect, it } from "bun:test";
import { __test__ } from "./use-autocomplete";

describe("use-autocomplete helpers", () => {
  it("removes duplicated typed prefix from completion", () => {
    const normalized = __test__.normalizeCompletionText(
      "dialog {\n  border: none;\n}\n",
      "dialog",
      "",
    );

    expect(normalized).toBe(" {\n  border: none;\n}\n");
  });

  it("removes trailing overlap with text already after cursor", () => {
    const normalized = __test__.normalizeCompletionText(
      "value;\nreturn x;",
      "const a = ",
      "return x;",
    );

    expect(normalized).toBe("value;\n");
  });

  it("triggers on newline after block opener context", () => {
    const content = "div {\n";
    const shouldTrigger = __test__.shouldTriggerForCharacter(content, content.length);
    expect(shouldTrigger).toBe(true);
  });

  it("does not trigger on unrelated punctuation", () => {
    const content = "+";
    const shouldTrigger = __test__.shouldTriggerForCharacter(content, content.length);
    expect(shouldTrigger).toBe(false);
  });
});
