import { describe, expect, it } from "vite-plus/test";
import type { SubscriptionInfo } from "@/features/window/services/auth-api";
import { hasProductCapability } from "../lib/product-capabilities";

function subscription(
  value: Pick<SubscriptionInfo, "status"> & Partial<SubscriptionInfo>,
): SubscriptionInfo {
  return {
    subscription: null,
    enterprise: { has_access: false, is_admin: false, policy: null },
    ...value,
  };
}

describe("product capabilities", () => {
  it("uses server-provided capabilities instead of inferring from plan status", () => {
    const value = subscription({
      status: "pro",
      capabilities: {
        hostedAi: false,
        settingsSync: true,
        collaboration: false,
        enterprisePolicy: true,
      },
    });

    expect(hasProductCapability(value, "hostedAi")).toBe(false);
    expect(hasProductCapability(value, "settingsSync")).toBe(true);
    expect(hasProductCapability(value, "enterprisePolicy")).toBe(true);
  });

  it("keeps compatibility with subscription responses from older servers", () => {
    expect(hasProductCapability(subscription({ status: "pro" }), "hostedAi")).toBe(true);
    expect(hasProductCapability(subscription({ status: "free" }), "settingsSync")).toBe(false);
    expect(
      hasProductCapability(
        subscription({ status: "free", collaboration: { enabled: true } as never }),
        "collaboration",
      ),
    ).toBe(true);
  });
});
