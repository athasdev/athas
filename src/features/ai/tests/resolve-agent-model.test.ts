import { describe, expect, it } from "vite-plus/test";
import { resolveAgentModel } from "../intelligence/lib/resolve-agent-model";
import type { ModelProvider } from "../types/providers.types";

const provider: ModelProvider = {
  id: "custom",
  name: "Custom",
  apiUrl: "",
  requiresApiKey: false,
  models: [],
};
describe("agent model choices", () => {
  it("preserves the explicit task model when the device has a different custom default", () => {
    expect(
      resolveAgentModel({
        provider,
        modelId: "chosen-model",
        customDefault: "device-model",
        dynamicModels: [],
      })?.id,
    ).toBe("chosen-model");
  });
  it("accepts a new direct-provider model before the bundled catalog is updated", () => {
    expect(
      resolveAgentModel({
        provider: { ...provider, id: "anthropic" },
        modelId: "new-model",
        dynamicModels: [],
      })?.id,
    ).toBe("new-model");
  });
  it("uses only the selected provider's catalog and preserves its limits", () => {
    expect(
      resolveAgentModel({
        provider,
        modelId: "shared-name",
        dynamicModels: [{ id: "shared-name", name: "Configured", maxOutputTokens: 8192 }],
      }),
    ).toEqual({ id: "shared-name", name: "Configured", maxOutputTokens: 8192 });
    expect(
      resolveAgentModel({
        provider: undefined,
        modelId: "shared-name",
        dynamicModels: [{ id: "shared-name", name: "Elsewhere" }],
      }),
    ).toBeUndefined();
  });
  it("uses the old custom default only when no model was selected", () => {
    expect(
      resolveAgentModel({ provider, modelId: "", customDefault: "device-model", dynamicModels: [] })
        ?.id,
    ).toBe("device-model");
  });
});
