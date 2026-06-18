import type { ExtensionManifest } from "@/extensions/types/extension-manifest";

export const V0_EXTENSION_ID = "athas.ai.v0";
export const V0_PROVIDER_ID = "v0";
export const V0_DESIGN_SYSTEM_VIEW_ID = `extension:${V0_EXTENSION_ID}.design-systems` as const;

export const v0ExtensionManifest: ExtensionManifest = {
  id: V0_EXTENSION_ID,
  name: "v0",
  displayName: "v0",
  description: "Generate apps with v0 and optional shadcn registry design-system context.",
  version: "1.0.0",
  publisher: "Athas",
  categories: ["AI"],
  activationEvents: [`onAIProvider:${V0_PROVIDER_ID}`],
  installation: {
    type: "bundled",
  },
  aiProviders: [
    {
      id: V0_PROVIDER_ID,
      name: "v0",
      apiUrl: "https://api.v0.dev/v1/chats",
      requiresApiKey: true,
      maxTokens: 50000,
      apiKeyUrl: "https://v0.dev/chat/settings/keys",
      apiKeyPlaceholder: "v0_xxxxxxxxxxxxxxxxxxxx",
      models: [
        {
          id: "v0-auto",
          name: "v0 Auto",
          maxTokens: 50000,
        },
        {
          id: "v0-mini",
          name: "v0 Mini",
          maxTokens: 50000,
        },
        {
          id: "v0-pro",
          name: "v0 Pro",
          maxTokens: 50000,
        },
        {
          id: "v0-max",
          name: "v0 Max",
          maxTokens: 50000,
        },
        {
          id: "v0-max-fast",
          name: "v0 Max Fast",
          maxTokens: 50000,
        },
      ],
    },
  ],
};
