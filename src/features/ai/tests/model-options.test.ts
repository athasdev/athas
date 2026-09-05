import { describe, expect, it } from "vite-plus/test";
import { resolveModelOptions } from "@/features/ai/lib/model-options";

describe("model options", () => {
  it("keeps known models usable while discovery is loading", () => {
    expect(
      resolveModelOptions({
        staticModels: [{ id: "static", name: "Static" }],
        fetchedModels: [],
        customModels: [],
      }),
    ).toEqual([{ id: "static", name: "Static" }]);
  });

  it("reveals one merged catalog after model discovery settles", () => {
    expect(
      resolveModelOptions({
        staticModels: [
          { id: "shared", name: "Shared static", maxTokens: 2048, proOnly: true },
          { id: "static", name: "Static" },
        ],
        fetchedModels: [
          { id: "shared", name: "Shared fetched", maxTokens: 8192 },
          { id: "dynamic", name: "Dynamic" },
        ],
        customModels: [{ id: "custom", name: "Custom" }],
      }),
    ).toEqual([
      { id: "shared", name: "Shared fetched", maxOutputTokens: 8192, proOnly: true },
      { id: "static", name: "Static" },
      { id: "dynamic", name: "Dynamic", maxOutputTokens: 4096 },
      { id: "custom", name: "Custom" },
    ]);
  });
});
