import { describe, expect, it } from "vite-plus/test";
import type { AuthUser, SubscriptionInfo } from "../services/auth-api";
import { resolveProFeatureAccess } from "../hooks/use-pro-feature";

const proUser = { subscription_status: "free", subscriptionStatus: "pro" } satisfies Pick<
  AuthUser,
  "subscription_status" | "subscriptionStatus"
>;

function subscription(
  value: Pick<SubscriptionInfo, "status"> & Partial<SubscriptionInfo>,
): SubscriptionInfo {
  return {
    subscription: null,
    enterprise: { has_access: false, is_admin: false, policy: null },
    ...value,
  };
}

describe("Pro feature access", () => {
  it("unlocks Pro surfaces from the camel-case API snapshot while details refresh", () => {
    expect(resolveProFeatureAccess(proUser, null)).toMatchObject({
      hasIntelligence: true,
      hasSettingsSync: true,
      hasCloudWorkspaces: true,
    });
  });

  it("keeps explicit server capabilities authoritative", () => {
    const access = resolveProFeatureAccess(
      proUser,
      subscription({
        status: "pro",
        capabilities: {
          intelligence: false,
          hostedAi: false,
          settingsSync: true,
          cloudWorkspaces: false,
          collaboration: false,
          enterprisePolicy: false,
        },
      }),
    );

    expect(access).toMatchObject({
      hasIntelligence: false,
      hasSettingsSync: true,
      hasCloudWorkspaces: false,
    });
  });
});
