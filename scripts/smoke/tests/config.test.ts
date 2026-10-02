import { describe, expect, it } from "vitest";
import { getSmokeLaunchPath, parseSmokeOptions } from "../config";

describe("smoke configuration", () => {
  it("uses the host platform and smoke identity by default", () => {
    expect(parseSmokeOptions([], "darwin")).toEqual({
      identity: "smoke",
      openOnly: false,
      targetPlatform: "macos",
    });
  });

  it("parses explicit identity and open-only options", () => {
    expect(
      parseSmokeOptions(["--platform", "linux", "--identity=stable", "--open-only"], "linux"),
    ).toEqual({
      identity: "stable",
      openOnly: true,
      targetPlatform: "linux",
    });
  });

  it("rejects cross-platform smoke targets", () => {
    expect(() => parseSmokeOptions(["--platform", "windows"], "darwin")).toThrow(
      "must be run on windows",
    );
  });

  it("resolves the expected identity-specific macOS bundle", () => {
    expect(getSmokeLaunchPath("/repo", "macos", "smoke")).toBe(
      "/repo/target/debug/bundle/macos/Athas Smoke.app",
    );
  });
});
