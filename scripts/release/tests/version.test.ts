import { describe, expect, it } from "vitest";
import { bumpVersion, formatVersion, getWindowsMsiVersion, parseVersion } from "../version";

describe("release versions", () => {
  it("parses and formats release versions", () => {
    expect(formatVersion(parseVersion("1.2.3"))).toBe("1.2.3");
  });

  it("bumps the requested version part", () => {
    expect(bumpVersion(parseVersion("1.2.3"), "patch")).toEqual({ major: 1, minor: 2, patch: 4 });
    expect(bumpVersion(parseVersion("1.2.3"), "minor")).toEqual({ major: 1, minor: 3, patch: 0 });
    expect(bumpVersion(parseVersion("1.2.3"), "major")).toEqual({ major: 2, minor: 0, patch: 0 });
  });

  it("maps versions to ordered numeric MSI versions", () => {
    expect(getWindowsMsiVersion(parseVersion("1.2.3"))).toBe("1.2.3900");
    expect(getWindowsMsiVersion(parseVersion("1.2.4"))).toBe("1.2.4900");
  });

  it("rejects unsupported version formats", () => {
    expect(() => parseVersion("1.2.3-preview.1")).toThrow("Invalid version format");
    expect(() => getWindowsMsiVersion(parseVersion("1.2.65"))).toThrow("patch versions up to 64");
  });
});
