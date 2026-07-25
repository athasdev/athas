import { describe, expect, it } from "vite-plus/test";
import type { SubscriptionInfo } from "@/features/window/services/auth-api";
import { getAiUsageModeLabel } from "../lib/account-usage";

function subscription(status: SubscriptionInfo["status"]): SubscriptionInfo {
  return {
    status,
    subscription: null,
    enterprise: { has_access: false, is_admin: false, policy: null },
  };
}

describe("account usage", () => {
  it("describes a configured user-provided key without internal terminology", () => {
    expect(
      getAiUsageModeLabel({
        isAuthenticated: true,
        subscription: subscription("free"),
        hasOpenRouterKey: true,
      }),
    ).toBe("Your API key");
  });
});
