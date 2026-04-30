import { describe, expect, it } from "vite-plus/test";
import { convertLintDiagnostic } from "./diagnostics-store";

describe("convertLintDiagnostic", () => {
  it("normalizes linter diagnostics to the 0-based diagnostics model", () => {
    expect(
      convertLintDiagnostic("/tmp/app.ts", {
        line: 12,
        column: 5,
        endLine: 12,
        endColumn: 9,
        severity: "warning",
        message: "Unexpected value",
        code: "no-value",
        source: "eslint",
      }),
    ).toEqual({
      severity: "warning",
      filePath: "/tmp/app.ts",
      line: 11,
      column: 4,
      endLine: 11,
      endColumn: 8,
      message: "Unexpected value",
      source: "eslint",
      code: "no-value",
    });
  });

  it("maps hint diagnostics to info and supplies an end range", () => {
    expect(
      convertLintDiagnostic("/tmp/app.ts", {
        line: 1,
        column: 1,
        severity: "hint",
        message: "Consider refactoring",
      }),
    ).toEqual({
      severity: "info",
      filePath: "/tmp/app.ts",
      line: 0,
      column: 0,
      endLine: 0,
      endColumn: 1,
      message: "Consider refactoring",
      source: "linter",
      code: undefined,
    });
  });
});
