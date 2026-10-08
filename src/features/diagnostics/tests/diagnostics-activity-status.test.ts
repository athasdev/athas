import { describe, expect, it } from "vite-plus/test";
import { buildDiagnosticsActivityStatus } from "../lib/diagnostics-activity-status";

function counts({ error = 0, warning = 0, info = 0 }) {
  return { error, warning, info };
}

describe("buildDiagnosticsActivityStatus", () => {
  it("hides diagnostics when the feature is disabled or empty", () => {
    expect(buildDiagnosticsActivityStatus(false, counts({ error: 1 }))).toBeNull();
    expect(buildDiagnosticsActivityStatus(true, counts({}))).toBeNull();
  });

  it("uses a soft warning tone when warnings are the highest severity", () => {
    expect(buildDiagnosticsActivityStatus(true, counts({ warning: 1, info: 1 }))).toEqual({
      count: 2,
      tone: "warning",
      tooltip: "2 diagnostics: 1 warning, 1 info",
    });
  });

  it("gives errors priority over warnings", () => {
    expect(buildDiagnosticsActivityStatus(true, counts({ warning: 1, error: 1 }))).toEqual({
      count: 2,
      tone: "error",
      tooltip: "2 diagnostics: 1 error, 1 warning",
    });
  });

  it("keeps information-only diagnostics neutral", () => {
    expect(buildDiagnosticsActivityStatus(true, counts({ info: 1 }))).toEqual({
      count: 1,
      tone: "default",
      tooltip: "1 diagnostic: 1 info",
    });
  });
});
