import { describe, expect, it } from "vite-plus/test";
import { buildDiagnosticsFooterStatus } from "../lib/diagnostics-footer-status";

describe("buildDiagnosticsFooterStatus", () => {
  it("hides diagnostics when the feature is disabled", () => {
    expect(buildDiagnosticsFooterStatus(false, 3)).toBeNull();
  });

  it("hides diagnostics when there are no problems", () => {
    expect(buildDiagnosticsFooterStatus(true, 0)).toBeNull();
  });

  it("summarizes active diagnostics", () => {
    expect(buildDiagnosticsFooterStatus(true, 2)).toEqual({
      count: 2,
      tooltip: "2 diagnostics",
    });
  });
});
