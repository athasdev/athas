import { describe, expect, it } from "vite-plus/test";
import { classifySessionConfigOption } from "../lib/session-config-option-classifier";
import type { SessionConfigOption } from "../types/acp";

function selectOption(option: Partial<SessionConfigOption>): SessionConfigOption {
  return {
    id: "custom",
    name: "Custom",
    description: undefined,
    kind: {
      type: "select",
      currentValue: "default",
      options: [{ id: "default", name: "Default" }],
    },
    ...option,
  };
}

describe("classifySessionConfigOption", () => {
  it("prefers ACP semantic categories over label heuristics", () => {
    expect(
      classifySessionConfigOption(
        selectOption({
          id: "effort",
          name: "Model style",
          category: "thought_level",
        }),
      ),
    ).toBe("thought_level");
  });

  it("falls back to text classification when category is missing or custom", () => {
    expect(classifySessionConfigOption(selectOption({ name: "Model" }))).toBe("model");
    expect(classifySessionConfigOption(selectOption({ category: "_vendor" }))).toBe("other");
  });
});
