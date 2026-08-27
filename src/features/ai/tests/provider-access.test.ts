import { describe, expect, it } from "vite-plus/test";
import {
  canUseIntelligenceProvider,
  canUseProviderWithoutApiKey,
} from "@/features/ai/lib/provider-access";
import type { SubscriptionInfo } from "@/features/window/services/auth-api";

const subscription: SubscriptionInfo = {
  status: "pro",
  subscription: { plan: "pro", renews_at: null, ends_at: null },
  capabilities: {
    intelligence: true,
    hostedAi: true,
    settingsSync: true,
    cloudWorkspaces: true,
    views: true,
    collaboration: true,
    enterprisePolicy: false,
  },
  enterprise: { has_access: false, is_admin: false, policy: null },
};

describe("provider access", () => {
  it("uses Athas Intelligence only for focused OpenRouter features", () => {
    expect(canUseIntelligenceProvider("openrouter", subscription)).toBe(true);
    expect(canUseIntelligenceProvider("anthropic", subscription)).toBe(false);
  });

  it("does not treat Pro as a provider credential for Athas Agent", () => {
    expect(
      canUseProviderWithoutApiKey({
        providerId: "openrouter",
        subscription,
        hasStoredKey: false,
        requiresApiKey: true,
      }),
    ).toBe(false);
  });
});
