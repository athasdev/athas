import { describe, expect, it } from "vitest";
import {
  bumpStableBase,
  formatVersion,
  getReleaseCommitMessage,
  getWindowsMsiVersion,
  parsePrerelease,
  parseVersion,
} from "../version";

describe("release versions", () => {
  it("parses and formats stable and preview versions", () => {
    expect(formatVersion(parseVersion("1.2.3"))).toBe("1.2.3");
    expect(formatVersion(parseVersion("1.2.3-preview.4"))).toBe("1.2.3-preview.4");
    expect(parsePrerelease("1.2.3-preview.4")).toEqual({ channel: "preview", number: 4 });
  });

  it("bumps stable versions without advancing an existing preview base", () => {
    expect(bumpStableBase(parseVersion("1.2.3"), "patch")).toEqual({
      major: 1,
      minor: 2,
      patch: 4,
    });
    expect(bumpStableBase(parseVersion("1.2.3-preview.4"), "patch")).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
    });
  });

  it("selects the release commit message from the channel", () => {
    expect(getReleaseCommitMessage(parseVersion("1.2.3"))).toBe("Prepare release");
    expect(getReleaseCommitMessage(parseVersion("1.2.3-preview.4"))).toBe(
      "Prepare preview release",
    );
  });

  it("maps stable and preview versions to ordered numeric MSI versions", () => {
    expect(getWindowsMsiVersion(parseVersion("1.2.3-preview.4"))).toBe("1.2.3004");
    expect(getWindowsMsiVersion(parseVersion("1.2.3"))).toBe("1.2.3900");
    expect(getWindowsMsiVersion(parseVersion("1.2.4-preview.1"))).toBe("1.2.4001");
  });

  it("rejects unsupported version formats", () => {
    expect(() => parseVersion("1.2.3-alpha.1")).toThrow("Invalid version format");
    expect(() => getWindowsMsiVersion(parseVersion("1.2.65"))).toThrow("patch versions up to 64");
  });
});
