import { describe, expect, it } from "vite-plus/test";
import type { Diagnostic, DiagnosticCodeAction } from "../types/diagnostics";
import { selectDiagnosticForQuickFix, selectPreferredCodeAction } from "../utils/quick-fix";

function diagnostic(overrides: Partial<Diagnostic>): Diagnostic {
  return {
    severity: "warning",
    filePath: "/tmp/app.ts",
    line: 0,
    column: 0,
    endLine: 0,
    endColumn: 1,
    message: "Diagnostic",
    ...overrides,
  };
}

function action(overrides: Partial<DiagnosticCodeAction>): DiagnosticCodeAction {
  return {
    id: "action",
    title: "Action",
    isPreferred: false,
    hasCommand: false,
    hasEdit: true,
    payload: {},
    ...overrides,
  };
}

describe("quick fix helpers", () => {
  it("selects the containing diagnostic before same-line neighbors", () => {
    expect(
      selectDiagnosticForQuickFix(
        [
          diagnostic({ message: "near", line: 2, column: 12, endLine: 2, endColumn: 16 }),
          diagnostic({ message: "hit", line: 2, column: 4, endLine: 2, endColumn: 8 }),
        ],
        { line: 2, column: 5 },
      )?.message,
    ).toBe("hit");
  });

  it("falls back to the nearest same-line diagnostic", () => {
    expect(
      selectDiagnosticForQuickFix(
        [
          diagnostic({ message: "far", line: 2, column: 40, endLine: 2, endColumn: 45 }),
          diagnostic({ message: "near", line: 2, column: 12, endLine: 2, endColumn: 16 }),
        ],
        { line: 2, column: 10 },
      )?.message,
    ).toBe("near");
  });

  it("prefers preferred code actions and ignores disabled actions", () => {
    expect(
      selectPreferredCodeAction([
        action({ title: "Disabled", isPreferred: true, disabledReason: "No edit" }),
        action({ title: "Fallback" }),
        action({ title: "Preferred", isPreferred: true }),
      ])?.title,
    ).toBe("Preferred");
  });
});
