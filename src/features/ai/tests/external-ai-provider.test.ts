import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  registerExternalAIProvider,
  unregisterExternalAIProviders,
} from "@/features/ai/services/providers/external-ai-provider";
import {
  buildProviderSystemPromptContext,
  getProvider,
  shouldUseTauriFetchForProvider,
} from "@/features/ai/services/providers/ai-provider-registry";
import type { ExtensionManifest } from "@/extensions/types/extension-manifest";

const extensionId = "athas.ai.external-test";
const manifest = {
  id: extensionId,
  name: "external-test",
  displayName: "External Test",
  description: "External provider test",
  version: "1.0.0",
  publisher: "Athas",
  categories: ["AI"],
  aiProviders: [
    {
      id: "external-test",
      name: "External Test",
      apiUrl: "https://example.test/chats",
      requiresApiKey: true,
      transport: "tauri",
      models: [{ id: "external-model", name: "External Model", maxTokens: 4096 }],
    },
  ],
} satisfies ExtensionManifest;

describe("external AI providers", () => {
  afterEach(() => unregisterExternalAIProviders(extensionId));

  it("delegates provider behavior to the external extension worker", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "aiProvider.buildHeaders") return { Authorization: "Bearer test" };
      if (method === "aiProvider.buildPayload") return { message: "External payload" };
      if (method === "aiProvider.buildUrl") return "https://example.test/chats";
      if (method === "aiProvider.validateApiKey") return true;
      if (method === "aiProvider.getModels") return [];
      if (method === "aiProvider.getSystemPromptContext") return "External prompt context";
      return undefined;
    });

    registerExternalAIProvider({
      extensionId,
      manifest,
      providerId: "external-test",
      request,
    });

    const provider = getProvider("external-test");
    expect(provider).toBeDefined();
    await expect(provider?.buildHeaders("test")).resolves.toEqual({
      Authorization: "Bearer test",
    });
    await expect(
      provider?.buildPayload({
        modelId: "external-model",
        messages: [{ role: "user", content: "Hello" }],
        maxTokens: 1000,
        temperature: 0.7,
      }),
    ).resolves.toEqual({ message: "External payload" });
    await expect(provider?.validateApiKey("test")).resolves.toBe(true);
    await expect(buildProviderSystemPromptContext("external-test", {} as never)).resolves.toBe(
      "External prompt context",
    );
    expect(shouldUseTauriFetchForProvider("external-test")).toBe(true);
  });
});
