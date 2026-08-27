import { describe, expect, it } from "vite-plus/test";
import { buildDiagnosticsActivityStatus } from "../lib/diagnostics-activity-status";
import type { Diagnostic } from "../types/diagnostics.types";

function diagnostic(severity: Diagnostic["severity"]): Diagnostic {
  return {
    severity,
    filePath: "/project/src/app.ts",
    line: 0,
    column: 0,
    endLine: 0,
    endColumn: 1,
    message: `${severity} diagnostic`,
  };
}

describe("buildDiagnosticsActivityStatus", () => {
  it("hides diagnostics when the feature is disabled or empty", () => {
    expect(buildDiagnosticsActivityStatus(false, [diagnostic("error")])).toBeNull();
    expect(buildDiagnosticsActivityStatus(true, [])).toBeNull();
  });

  it("uses a soft warning tone when warnings are the highest severity", () => {
    expect(
      buildDiagnosticsActivityStatus(true, [diagnostic("warning"), diagnostic("info")]),
    ).toEqual({
      count: 2,
      tone: "warning",
      tooltip: "2 diagnostics: 1 warning, 1 info",
    });
  });

  it("gives errors priority over warnings", () => {
    expect(
      buildDiagnosticsActivityStatus(true, [diagnostic("warning"), diagnostic("error")]),
    ).toEqual({
      count: 2,
      tone: "error",
      tooltip: "2 diagnostics: 1 error, 1 warning",
    });
  });

  it("keeps information-only diagnostics neutral", () => {
    expect(buildDiagnosticsActivityStatus(true, [diagnostic("info")])).toEqual({
      count: 1,
      tone: "default",
      tooltip: "1 diagnostic: 1 info",
    });
  });
});
