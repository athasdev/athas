import { describe, expect, it } from "vite-plus/test";
import type { Diagnostic } from "@/features/diagnostics/types/diagnostics.types";
import {
  buildDiagnosticDecorations,
  buildDiagnosticDecorationsByLine,
  getDiagnosticAtPosition,
} from "../decorations/diagnostic-decorations";

function diagnostic(overrides: Partial<Diagnostic>): Diagnostic {
  return {
    severity: "error",
    filePath: "/tmp/file.ts",
    line: 0,
    column: 0,
    endLine: 0,
    endColumn: 0,
    message: "Broken",
    ...overrides,
  };
}

describe("diagnostic decorations", () => {
  it("expands empty ranges to the surrounding word", () => {
    const decorations = buildDiagnosticDecorations(
      [diagnostic({ line: 0, column: 8, endLine: 0, endColumn: 8 })],
      ["const value = 1;"],
    );

    expect(decorations[0]).toMatchObject({
      line: 0,
      startColumn: 6,
      endColumn: 11,
    });
  });

  it("splits multiline diagnostics into per-line decorations", () => {
    const decorations = buildDiagnosticDecorations(
      [diagnostic({ line: 0, column: 2, endLine: 1, endColumn: 3 })],
      ["first", "second"],
    );

    expect(
      decorations.map(({ line, startColumn, endColumn }) => ({ line, startColumn, endColumn })),
    ).toEqual([
      { line: 0, startColumn: 2, endColumn: 5 },
      { line: 1, startColumn: 0, endColumn: 3 },
    ]);
  });

  it("hit-tests the highest severity diagnostic at a model position", () => {
    const warning = diagnostic({
      severity: "warning",
      line: 0,
      column: 0,
      endLine: 0,
      endColumn: 10,
      message: "Warning",
    });
    const error = diagnostic({
      severity: "error",
      line: 0,
      column: 3,
      endLine: 0,
      endColumn: 7,
      message: "Error",
    });

    expect(getDiagnosticAtPosition([warning, error], ["abcdefghij"], 0, 4)?.message).toBe("Error");
  });

  it("maps actual diagnostic lines through folded virtual lines", () => {
    const decorations = buildDiagnosticDecorations(
      [diagnostic({ line: 2, column: 0, endLine: 2, endColumn: 4 })],
      ["line0", "line2"],
      {
        actualToVirtual: new Map([
          [0, 0],
          [2, 1],
        ]),
        virtualToActual: new Map([
          [0, 0],
          [1, 2],
        ]),
      },
    );

    expect(decorations[0]).toMatchObject({ line: 1, startColumn: 0, endColumn: 4 });
  });

  it("indexes decorations by line using render priority order", () => {
    const warning = diagnostic({
      severity: "warning",
      line: 0,
      column: 0,
      endLine: 0,
      endColumn: 10,
      message: "Warning",
    });
    const error = diagnostic({
      severity: "error",
      line: 0,
      column: 0,
      endLine: 0,
      endColumn: 5,
      message: "Error",
    });

    const byLine = buildDiagnosticDecorationsByLine(
      buildDiagnosticDecorations([warning, error], ["abcdefghij"]),
    );

    expect(byLine.get(0)?.map((decoration) => decoration.diagnostic.message)).toEqual([
      "Warning",
      "Error",
    ]);
  });
});
