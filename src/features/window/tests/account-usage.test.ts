import { describe, expect, it } from "vite-plus/test";
import type { SubscriptionInfo } from "@/features/window/services/auth-api";
import { getAccountPlanLabel } from "../lib/account-usage";

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
});
