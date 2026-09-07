import { describe, expect, it } from "vite-plus/test";
import {
  buildWorkflowLogModel,
  createWorkflowLogDecorations,
  findAdjacentProblemLine,
  findWorkflowLogFileReferences,
  formatWorkflowLogTimestamp,
} from "../utils/github-workflow-log-model";
import { parseWorkflowLog } from "../utils/github-workflow-logs";

const ESC = String.fromCharCode(27);

const rawLog = [
  "2026-09-06T23:20:59.0000000Z Current runner version: '2.320.0'",
  "2026-09-06T23:21:00.1234567Z ##[group]Run actions/checkout@v4",
  "2026-09-06T23:21:00.2000000Z with:",
  "2026-09-06T23:21:00.3000000Z ##[endgroup]",
  "2026-09-06T23:21:01.0000000Z ##[group]Run cargo clippy",
  `2026-09-06T23:21:02.0000000Z ${ESC}[31merror${ESC}[0m: unused variable ${ESC}[1mfoo${ESC}[22m`,
  "2026-09-06T23:21:02.5000000Z   --> src/main.rs:12:9",
  "2026-09-06T23:21:03.0000000Z ##[warning]Something looks off",
  "2026-09-06T23:21:03.0000000Z ##[error]Process completed with exit code 101.",
  "2026-09-06T23:21:04.0000000Z ##[group]Post Run actions/checkout@v4",
  "2026-09-06T23:21:05.0000000Z cleaning up",
].join("\n");

describe("workflow log model", () => {
  it("renders rows, drops endgroup markers, and folds groups", () => {
    const model = buildWorkflowLogModel(parseWorkflowLog(rawLog), { showTimestamps: false });

    expect(model.rows).toHaveLength(10);
    expect(model.text.split("\n")[1]).toBe("Run actions/checkout@v4");
    expect(model.text.split("\n")[6]).toBe("[warning] Something looks off");
    expect(model.foldRanges).toEqual([
      { start: 2, end: 3 },
      { start: 4, end: 8 },
      { start: 9, end: 10 },
    ]);
    expect(model.problemLines).toEqual([7, 8]);
    expect(model.errorCount).toBe(1);
    expect(model.warningCount).toBe(1);
    expect(model.rows[7].index).toBe(8);
  });

  it("prefixes timestamps as a fixed-width column", () => {
    const model = buildWorkflowLogModel(parseWorkflowLog(rawLog), { showTimestamps: true });

    expect(formatWorkflowLogTimestamp("2026-09-06T23:21:00.1234567Z")).toBe("23:21:00.123");
    expect(formatWorkflowLogTimestamp("2026-09-06T23:21:00Z")).toBe("23:21:00.000");
    expect(model.text.split("\n")[0]).toBe("23:20:59.000 Current runner version: '2.320.0'");
  });

  it("creates decorations only for the requested window", () => {
    const model = buildWorkflowLogModel(parseWorkflowLog(rawLog), { showTimestamps: true });
    const decorations = createWorkflowLogDecorations(model, {
      fromLine: 5,
      toLine: 6,
      showTimestamps: true,
      highlightLine: 6,
    });

    expect(decorations).toEqual([
      { line: 5, startColumn: 1, endColumn: 13, className: "gha-log-timestamp", wholeLine: false },
      { line: 5, startColumn: 14, endColumn: 19, className: "gha-log-ansi-red", wholeLine: false },
      { line: 5, startColumn: 37, endColumn: 40, className: "gha-log-ansi-bold", wholeLine: false },
      { line: 6, startColumn: 1, endColumn: 13, className: "gha-log-timestamp", wholeLine: false },
      { line: 6, className: "gha-log-line-highlight", wholeLine: true },
    ]);
    expect(
      createWorkflowLogDecorations(model, { fromLine: 8, toLine: 8, showTimestamps: false }),
    ).toEqual([{ line: 8, className: "gha-log-line-error", wholeLine: true }]);
  });

  it("cycles through problem lines in both directions", () => {
    expect(findAdjacentProblemLine([7, 8], null, 1)).toBe(7);
    expect(findAdjacentProblemLine([7, 8], null, -1)).toBe(8);
    expect(findAdjacentProblemLine([7, 8], 7, 1)).toBe(8);
    expect(findAdjacentProblemLine([7, 8], 8, 1)).toBe(7);
    expect(findAdjacentProblemLine([7, 8], 7, -1)).toBe(8);
    expect(findAdjacentProblemLine([], 3, 1)).toBeNull();
  });

  it("finds file references with line and column positions", () => {
    const model = buildWorkflowLogModel(parseWorkflowLog(rawLog), { showTimestamps: false });
    const references = findWorkflowLogFileReferences(model, { showTimestamps: false });

    expect(references).toEqual([
      {
        line: 6,
        startColumn: 7,
        endColumn: 23,
        path: "src/main.rs",
        fileLine: 12,
        fileColumn: 9,
      },
    ]);
    expect(
      findWorkflowLogFileReferences(
        buildWorkflowLogModel(parseWorkflowLog(rawLog), { showTimestamps: true }),
        { showTimestamps: true },
      )[0],
    ).toMatchObject({ startColumn: 20, endColumn: 36 });
  });
});
