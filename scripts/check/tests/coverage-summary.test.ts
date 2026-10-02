import { describe, expect, it } from "vitest";
import { formatCoverageSummary, readCoverageTotals } from "../coverage-summary";

describe("coverage summary", () => {
  it("reads Vitest json-summary totals", () => {
    const report = {
      total: {
        lines: { total: 200, covered: 150, pct: 75 },
        branches: { total: 40, covered: 10, pct: 25 },
        functions: { total: 0, covered: 0, pct: 100 },
        statements: { total: 210, covered: 151, pct: 71.9 },
      },
    };

    expect(readCoverageTotals(report).lines).toEqual({ covered: 150, total: 200 });
    expect(formatCoverageSummary("Frontend", report)).toBe(
      [
        "### Frontend",
        "",
        "| Metric | Coverage | Covered |",
        "| --- | ---: | ---: |",
        "| lines | 75.00% | 150 / 200 |",
        "| branches | 25.00% | 10 / 40 |",
        "| functions | n/a | 0 / 0 |",
        "",
      ].join("\n"),
    );
  });

  it("reads cargo llvm-cov JSON export totals", () => {
    const report = {
      data: [
        {
          totals: {
            lines: { count: 1000, covered: 412, percent: 41.2 },
            branches: { count: 0, covered: 0, percent: 0 },
            functions: { count: 300, covered: 120, percent: 40 },
          },
        },
      ],
    };

    expect(readCoverageTotals(report)).toEqual({
      lines: { covered: 412, total: 1000 },
      branches: { covered: 0, total: 0 },
      functions: { covered: 120, total: 300 },
    });
  });

  it("rejects unknown report shapes", () => {
    expect(() => readCoverageTotals({})).toThrow("Unrecognized coverage report format.");
  });
});
