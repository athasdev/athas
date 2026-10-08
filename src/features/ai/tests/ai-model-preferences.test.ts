import { describe, expect, it } from "vite-plus/test";
import { defaultIntelligencePreferences } from "@/features/ai/intelligence/lib/intelligence-preferences";
import type { HostedUsageState } from "@/features/ai/services/hosted-usage";
import {
  AI_FEATURE_MODEL_OVERRIDES,
  countTaskOverrides,
  getEffectiveDefaultConnection,
  isConnectionAvailable,
  withDefaultConnection,
  withTaskConnection,
} from "../services/ai-model-preferences";
import { describeIncludedCredit } from "../services/athas-credit";

const openai = { providerId: "openai", modelId: "gpt-test" };
const ollama = { providerId: "ollama", modelId: "llama3" };

describe("AI model preferences", () => {
  it("shows the model the automatic default actually runs", () => {
    const preferences = defaultIntelligencePreferences();

    expect(
      getEffectiveDefaultConnection({
        preferences,
        hasIntelligence: true,
        personalConnection: openai,
        personalConnectionIsLocal: false,
      }),
    ).toEqual({ providerId: "athas", modelId: "auto" });
    expect(
      getEffectiveDefaultConnection({
        preferences,
        hasIntelligence: false,
        personalConnection: openai,
        personalConnectionIsLocal: false,
      }),
    ).toEqual(openai);
    expect(
      getEffectiveDefaultConnection({
        preferences,
        hasIntelligence: true,
        personalConnection: ollama,
        personalConnectionIsLocal: true,
      }),
    ).toEqual(ollama);
  });

  it("treats Athas as unavailable without a plan that includes it", () => {
    expect(isConnectionAvailable({ providerId: "athas", modelId: "auto" }, false)).toBe(false);
    expect(isConnectionAvailable({ providerId: "athas", modelId: "auto" }, true)).toBe(true);
    expect(isConnectionAvailable(ollama, false)).toBe(true);
  });

  it("ignores per-feature choices when describing the default", () => {
    const preferences = withTaskConnection(
      withDefaultConnection(defaultIntelligencePreferences(), openai),
      "agent",
      ollama,
    );

    expect(
      getEffectiveDefaultConnection({
        preferences,
        hasIntelligence: true,
        personalConnection: openai,
        personalConnectionIsLocal: false,
      }),
    ).toEqual(openai);
  });

  it("sets and clears a feature's model without touching the others", () => {
    const withCompletion = withTaskConnection(
      defaultIntelligencePreferences(),
      "autocomplete",
      ollama,
    );
    const withTitles = withTaskConnection(withCompletion, "chat-title", openai);

    expect(withTitles.tasks).toEqual({ autocomplete: ollama, "chat-title": openai });
    expect(withTaskConnection(withTitles, "autocomplete", null).tasks).toEqual({
      "chat-title": openai,
    });
    expect(withCompletion.tasks).toEqual({ autocomplete: ollama });
  });

  it("counts changed features apart from Tab completion", () => {
    const preferences = withTaskConnection(
      withTaskConnection(defaultIntelligencePreferences(), "autocomplete", ollama),
      "commit-message",
      openai,
    );
    const tasks = AI_FEATURE_MODEL_OVERRIDES.map(({ task }) => task);

    expect(tasks).not.toContain("autocomplete");
    expect(countTaskOverrides(preferences, tasks)).toBe(1);
  });
});

describe("Athas included credit", () => {
  const usage: HostedUsageState = {
    usedPercent: 25,
    level: "ok",
    remainingCents: 750,
    usedCents: 250,
    pendingCents: 0,
    allowanceCents: 1000,
    walletBalanceCents: null,
    periodEnd: new Date("2026-10-01T12:00:00Z"),
  };

  it("says how much is left and when it resets", () => {
    expect(describeIncludedCredit(usage)).toBe("$7.50 of $10.00 left · resets Oct 1");
  });

  it("says usage continues from the balance once included credit is used up", () => {
    expect(
      describeIncludedCredit({
        ...usage,
        level: "included_exhausted",
        remainingCents: 0,
        walletBalanceCents: 312.5,
        periodEnd: null,
      }),
    ).toBe("Included credit used, on balance");
    expect(
      describeIncludedCredit({
        ...usage,
        level: "exhausted",
        remainingCents: 0,
        walletBalanceCents: 0,
        periodEnd: null,
      }),
    ).toBe("Included credit used, add credit to continue");
  });
});
