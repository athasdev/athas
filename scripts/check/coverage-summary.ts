// Formats a coverage report as a Markdown table for the GitHub job summary.
// Reads either the Istanbul json-summary written by Vitest or the JSON
// export written by `cargo llvm-cov --json --summary-only`.

const metrics = ["lines", "branches", "functions"] as const;

type Metric = (typeof metrics)[number];

export interface CoverageTotals {
  covered: number;
  total: number;
}

interface IstanbulMetric {
  total: number;
  covered: number;
}

interface LlvmMetric {
  count: number;
  covered: number;
}

interface IstanbulSummary {
  total: Record<Metric, IstanbulMetric>;
}

interface LlvmExport {
  data: { totals: Record<Metric, LlvmMetric> }[];
}

export function readCoverageTotals(report: unknown): Record<Metric, CoverageTotals> {
  if (report && typeof report === "object" && "total" in report) {
    const { total } = report as IstanbulSummary;
    return Object.fromEntries(
      metrics.map((metric) => [
        metric,
        { covered: total[metric].covered, total: total[metric].total },
      ]),
    ) as Record<Metric, CoverageTotals>;
  }

  if (report && typeof report === "object" && "data" in report) {
    const totals = (report as LlvmExport).data[0]?.totals;
    if (!totals) throw new Error("llvm-cov export has no totals.");
    return Object.fromEntries(
      metrics.map((metric) => [
        metric,
        { covered: totals[metric].covered, total: totals[metric].count },
      ]),
    ) as Record<Metric, CoverageTotals>;
  }

  throw new Error("Unrecognized coverage report format.");
}

function formatPercent({ covered, total }: CoverageTotals) {
  return total === 0 ? "n/a" : `${((covered / total) * 100).toFixed(2)}%`;
}

export function formatCoverageSummary(title: string, report: unknown) {
  const totals = readCoverageTotals(report);
  return [
    `### ${title}`,
    "",
    "| Metric | Coverage | Covered |",
    "| --- | ---: | ---: |",
    ...metrics.map(
      (metric) =>
        `| ${metric} | ${formatPercent(totals[metric])} | ${totals[metric].covered} / ${totals[metric].total} |`,
    ),
    "",
  ].join("\n");
}

if (import.meta.main) {
  const [title, reportPath] = process.argv.slice(2);
  if (!title || !reportPath) {
    throw new Error("Usage: bun scripts/check/coverage-summary.ts <title> <report.json>");
  }
  console.log(formatCoverageSummary(title, await Bun.file(reportPath).json()));
}
