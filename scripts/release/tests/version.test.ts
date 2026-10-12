import { describe, expect, it } from "vitest";
import {
  bumpVersion,
  formatVersion,
  getWindowsMsiVersion,
  parseVersion,
  type ReleaseBump,
  type StableReleaseBump,
} from "../version";

function next(version: string, bump: ReleaseBump, betaBase?: StableReleaseBump) {
  return formatVersion(bumpVersion(parseVersion(version), bump, betaBase));
}

describe("release versions", () => {
  it("parses and formats release versions", () => {
    expect(formatVersion(parseVersion("1.2.3"))).toBe("1.2.3");
    expect(formatVersion(parseVersion("1.2.3-beta.4"))).toBe("1.2.3-beta.4");
  });

  it("bumps the requested version part", () => {
    expect(bumpVersion(parseVersion("1.2.3"), "patch")).toEqual({ major: 1, minor: 2, patch: 4 });
    expect(bumpVersion(parseVersion("1.2.3"), "minor")).toEqual({ major: 1, minor: 3, patch: 0 });
    expect(bumpVersion(parseVersion("1.2.3"), "major")).toEqual({ major: 2, minor: 0, patch: 0 });
  });

  it("starts and continues beta builds", () => {
    expect(next("0.16.1", "beta")).toBe("0.16.2-beta.1");
    expect(next("0.16.1", "beta", "minor")).toBe("0.17.0-beta.1");
    expect(next("0.16.1", "beta", "major")).toBe("1.0.0-beta.1");
    expect(next("0.16.2-beta.1", "beta")).toBe("0.16.2-beta.2");
    expect(next("0.16.2-beta.9", "beta", "minor")).toBe("0.16.2-beta.10");
  });

  it("promotes a beta to the stable version it leads up to", () => {
    expect(next("0.16.2-beta.3", "patch")).toBe("0.16.2");
    expect(next("0.17.0-beta.3", "minor")).toBe("0.17.0");
    expect(next("0.17.0-beta.3", "patch")).toBe("0.17.0");
    expect(next("0.16.2-beta.3", "minor")).toBe("0.17.0");
    expect(next("1.0.0-beta.1", "major")).toBe("1.0.0");
    expect(next("0.16.2-beta.1", "major")).toBe("1.0.0");
  });

  it("maps versions to ordered numeric MSI versions", () => {
    expect(getWindowsMsiVersion(parseVersion("1.2.3"))).toBe("1.2.3900");
    expect(getWindowsMsiVersion(parseVersion("1.2.4"))).toBe("1.2.4900");
    expect(getWindowsMsiVersion(parseVersion("1.2.4-beta.1"))).toBe("1.2.4001");
    expect(getWindowsMsiVersion(parseVersion("1.2.4-beta.12"))).toBe("1.2.4012");
  });

  it("orders beta MSI versions between the surrounding stable releases", () => {
    const build = (version: string) =>
      Number(getWindowsMsiVersion(parseVersion(version)).split(".")[2]);

    expect(build("1.2.3")).toBeLessThan(build("1.2.4-beta.1"));
    expect(build("1.2.4-beta.1")).toBeLessThan(build("1.2.4-beta.2"));
    expect(build("1.2.4-beta.2")).toBeLessThan(build("1.2.4"));
  });

  it("rejects unsupported version formats", () => {
    expect(() => parseVersion("1.2.3-preview.1")).toThrow("Invalid version format");
    expect(() => parseVersion("1.2.3-beta.0")).toThrow("Invalid version format");
    expect(() => getWindowsMsiVersion(parseVersion("1.2.65"))).toThrow("patch versions up to 64");
    expect(() => getWindowsMsiVersion(parseVersion("1.2.3-beta.900"))).toThrow(
      "beta numbers below 900",
    );
  });
});
