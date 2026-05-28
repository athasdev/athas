import { describe, expect, it } from "vite-plus/test";
import { convertLintDiagnostic, useDiagnosticsStore } from "../stores/diagnostics-store";

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

  it("keeps diagnostics from independent owners instead of overwriting the file", () => {
    const { actions } = useDiagnosticsStore.getState();
    actions.clearAllDiagnostics();

    actions.setDiagnostics(
      "/tmp/app.ts",
      [
        {
          severity: "error",
          filePath: "/tmp/app.ts",
          line: 0,
          column: 0,
          endLine: 0,
          endColumn: 4,
          message: "Type error",
        },
      ],
      "lsp",
    );
    actions.setDiagnostics(
      "/tmp/app.ts",
      [
        {
          severity: "warning",
          filePath: "/tmp/app.ts",
          line: 1,
          column: 0,
          endLine: 1,
          endColumn: 4,
          message: "Lint warning",
        },
      ],
      "linter",
    );

    expect(
      actions
        .getDiagnosticsForFile("/tmp/app.ts")
        .map(({ message, owner }) => ({ message, owner })),
    ).toEqual([
      { message: "Type error", owner: "lsp" },
      { message: "Lint warning", owner: "linter" },
    ]);

    actions.clearDiagnosticsForOwner("/tmp/app.ts", "lsp");

    expect(
      actions
        .getDiagnosticsForFile("/tmp/app.ts")
        .map(({ message, owner }) => ({ message, owner })),
    ).toEqual([{ message: "Lint warning", owner: "linter" }]);
  });

  it("preserves diagnostics array identity for unrelated files", () => {
    const { actions } = useDiagnosticsStore.getState();
    actions.clearAllDiagnostics();

    actions.setDiagnostics(
      "/tmp/app.ts",
      [
        {
          severity: "error",
          filePath: "/tmp/app.ts",
          line: 0,
          column: 0,
          endLine: 0,
          endColumn: 4,
          message: "Type error",
        },
      ],
      "lsp",
    );
    const appDiagnostics = actions.getDiagnosticsForFile("/tmp/app.ts");

    actions.setDiagnostics(
      "/tmp/other.ts",
      [
        {
          severity: "warning",
          filePath: "/tmp/other.ts",
          line: 1,
          column: 0,
          endLine: 1,
          endColumn: 4,
          message: "Other warning",
        },
      ],
      "lsp",
    );

    expect(actions.getDiagnosticsForFile("/tmp/app.ts")).toBe(appDiagnostics);
  });
});
