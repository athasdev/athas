import { describe, expect, it } from "vite-plus/test";
import type { SubscriptionInfo } from "@/features/auth/services/auth-api";
import { getAccountPlanLabel } from "../services/account-usage";

function subscription(status: SubscriptionInfo["status"]): SubscriptionInfo {
  return {
    status,
    subscription: null,
    enterprise: { has_access: false, is_admin: false, policy: null },
  };
}

describe("account usage", () => {
  it("labels Intelligence subscribers as Pro without exposing internal usage", () => {
    expect(getAccountPlanLabel(subscription("pro"), true)).toBe("Pro");
  });

  it("labels Plus subscribers as Plus", () => {
    const plus: SubscriptionInfo = {
      ...subscription("pro"),
      subscription: { plan: "plus", renews_at: null, ends_at: null },
    };
    expect(getAccountPlanLabel(plus, true)).toBe("Plus");
  });
});
