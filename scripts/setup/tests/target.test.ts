import { describe, expect, it } from "vitest";
import { getSetupTarget } from "../target";

describe("setup target", () => {
  it("maps every supported host to its own setup script", () => {
    expect(getSetupTarget("darwin")).toBe("macos");
    expect(getSetupTarget("linux")).toBe("linux");
    expect(getSetupTarget("win32")).toBe("windows");
  });

  it("rejects unsupported hosts", () => {
    expect(getSetupTarget("freebsd")).toBeNull();
  });
});
