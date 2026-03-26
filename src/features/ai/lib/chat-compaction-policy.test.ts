import { describe, expect, test } from "bun:test";
import {
  getChatCompactionPolicyShortLabel,
  isAutoCompactionEnabled,
  isCompactionTriggerEnabled,
  normalizeChatCompactionPolicy,
} from "./chat-compaction-policy";

describe("chat compaction policy helpers", () => {
  test("migrates legacy enabled auto-compaction to both triggers", () => {
    expect(normalizeChatCompactionPolicy(undefined, true)).toBe("threshold_and_overflow");
  });

  test("migrates legacy disabled auto-compaction to manual only", () => {
    expect(normalizeChatCompactionPolicy(undefined, false)).toBe("off");
  });

  test("preserves explicit policies", () => {
    expect(normalizeChatCompactionPolicy("overflow", true)).toBe("overflow");
  });

  test("enables only the configured triggers", () => {
    expect(isCompactionTriggerEnabled("threshold", "threshold")).toBe(true);
    expect(isCompactionTriggerEnabled("threshold", "overflow")).toBe(false);
    expect(isCompactionTriggerEnabled("overflow", "overflow")).toBe(true);
    expect(isCompactionTriggerEnabled("off", "threshold")).toBe(false);
  });

  test("reports whether auto compaction is armed", () => {
    expect(isAutoCompactionEnabled("off")).toBe(false);
    expect(isAutoCompactionEnabled("threshold_and_overflow")).toBe(true);
  });

  test("returns compact header labels", () => {
    expect(getChatCompactionPolicyShortLabel("threshold_and_overflow")).toBe("Both");
  });
});
