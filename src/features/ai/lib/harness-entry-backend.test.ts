import { describe, expect, test } from "bun:test";
import {
  getPreferredHarnessBackendForAgent,
  getPreferredHarnessEntryBackend,
} from "./harness-entry-backend";

describe("harness entry backend", () => {
  test("prefers pi-native for Pi", () => {
    expect(getPreferredHarnessBackendForAgent("pi")).toBe("pi-native");
  });

  test("keeps legacy bridge for non-Pi agents", () => {
    expect(getPreferredHarnessBackendForAgent("custom")).toBe("legacy-acp-bridge");
    expect(getPreferredHarnessBackendForAgent("claude-code")).toBe("legacy-acp-bridge");
  });

  test("defaults default Harness entry to pi-native", () => {
    expect(getPreferredHarnessEntryBackend()).toBe("pi-native");
  });
});
