import { describe, expect, it } from "vite-plus/test";
import {
  getTerminalCompatibilityOptions,
  parseWindowsBuildNumber,
} from "@/features/terminal/utils/terminal-options";

describe("terminal compatibility options", () => {
  it("keeps grid rendering deterministic across renderers", () => {
    expect(getTerminalCompatibilityOptions({ platform: "linux" })).toMatchObject({
      customGlyphs: true,
      reflowCursorLine: false,
      rescaleOverlappingGlyphs: true,
      scrollOnUserInput: true,
      smoothScrollDuration: 0,
    });
  });

  it("advertises local ConPTY details on Windows", () => {
    expect(
      getTerminalCompatibilityOptions({ platform: "windows", osVersion: "10.0.22631.4751" }),
    ).toMatchObject({
      windowsPty: { backend: "conpty", buildNumber: 22631 },
    });
  });

  it("does not apply local ConPTY heuristics to SSH terminals", () => {
    expect(
      getTerminalCompatibilityOptions({
        isRemote: true,
        platform: "windows",
        osVersion: "10.0.22631",
      }).windowsPty,
    ).toBeUndefined();
  });

  it("parses Windows versions without confusing revision and build numbers", () => {
    expect(parseWindowsBuildNumber("10.0.19045.5608")).toBe(19045);
    expect(parseWindowsBuildNumber("unknown")).toBeUndefined();
  });
});
