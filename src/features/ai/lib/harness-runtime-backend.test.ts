import { describe, expect, test } from "bun:test";
import {
  buildHarnessAgentBufferPath,
  DEFAULT_HARNESS_RUNTIME_BACKEND,
  parseHarnessAgentBufferPath,
} from "./harness-runtime-backend";

describe("harness runtime backend", () => {
  test("builds and parses backend-aware agent buffer paths", () => {
    const path = buildHarnessAgentBufferPath("workspace-main", "pi-native");

    expect(path).toBe("agent://pi-native/workspace-main");
    expect(parseHarnessAgentBufferPath(path)).toEqual({
      backend: "pi-native",
      sessionId: "workspace-main",
    });
  });

  test("treats legacy agent paths as legacy bridge buffers", () => {
    expect(parseHarnessAgentBufferPath("agent://harness")).toEqual({
      backend: DEFAULT_HARNESS_RUNTIME_BACKEND,
      sessionId: "harness",
    });
  });
});
