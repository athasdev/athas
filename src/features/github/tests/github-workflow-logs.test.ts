import { describe, expect, it } from "vite-plus/test";
import {
  filterWorkflowLog,
  findFirstProblemLine,
  formatWorkflowLogText,
  mapWorkflowLogToSteps,
  parseWorkflowLog,
  sliceWorkflowLog,
} from "../utils/github-workflow-logs";

const ESC = "\u001b";

const rawLog = [
  "2026-09-06T23:20:59.0000000Z Current runner version: '2.320.0'",
  "2026-09-06T23:21:00.1234567Z ##[group]Run actions/checkout@v4",
  "2026-09-06T23:21:00.2000000Z with:",
  "2026-09-06T23:21:00.3000000Z ##[endgroup]",
  "2026-09-06T23:21:01.0000000Z ##[group]Run Run cargo clippy",
  `2026-09-06T23:21:02.0000000Z ${ESC}[31merror${ESC}[0m: unused variable ${ESC}[1mfoo${ESC}[22m`,
  "2026-09-06T23:21:03.0000000Z ##[error]Process completed with exit code 101.",
  "2026-09-06T23:21:04.0000000Z ##[group]Post Run actions/checkout@v4",
  "2026-09-06T23:21:05.0000000Z cleaning up",
  "",
].join("\n");

describe("workflow log parsing", () => {
  it("splits timestamps, levels, and ANSI colours into structured lines", () => {
    const lines = parseWorkflowLog(rawLog);

    expect(lines).toHaveLength(9);
    expect(lines[1]).toMatchObject({
      timestamp: "2026-09-06T23:21:00.1234567Z",
      level: "group",
      text: "Run actions/checkout@v4",
    });
    expect(lines[5].text).toBe("error: unused variable foo");
    expect(lines[5].segments).toEqual([
      { text: "error", color: "red", bold: false },
      { text: ": unused variable ", color: null, bold: false },
      { text: "foo", color: null, bold: true },
    ]);
    expect(lines[6]).toMatchObject({
      level: "error",
      text: "Process completed with exit code 101.",
    });
  });

  it("maps steps onto their log ranges by group title", () => {
    const lines = parseWorkflowLog(rawLog);
    const steps = [
      { name: "Set up job", status: "completed", conclusion: "success" },
      { name: "Run actions/checkout@v4", status: "completed", conclusion: "success" },
      { name: "Run cargo clippy", status: "completed", conclusion: "failure" },
      { name: "Post Run actions/checkout@v4", status: "completed", conclusion: "success" },
    ];

    const ranges = mapWorkflowLogToSteps(lines, steps);

    expect(ranges[0]).toEqual({ start: 0, end: 1 });
    expect(ranges[1]).toEqual({ start: 1, end: 4 });
    expect(ranges[2]).toEqual({ start: 4, end: 7 });
    expect(ranges[3]).toEqual({ start: 7, end: 9 });
    expect(sliceWorkflowLog(lines, ranges[2]).map((line) => line.index)).toEqual([4, 5, 6]);
    expect(findFirstProblemLine(sliceWorkflowLog(lines, ranges[2]))).toBe(6);
  });

  it("filters and re-serialises lines for copying", () => {
    const lines = parseWorkflowLog(rawLog);

    expect(filterWorkflowLog(lines, "clippy").map((line) => line.index)).toEqual([4]);
    expect(filterWorkflowLog(lines, "error").map((line) => line.index)).toEqual([5, 6]);
    expect(formatWorkflowLogText(lines.slice(4, 7), false)).toBe(
      [
        "Run Run cargo clippy",
        "error: unused variable foo",
        "[error] Process completed with exit code 101.",
      ].join("\n"),
    );
    expect(formatWorkflowLogText(lines.slice(5, 6), true)).toBe(
      "2026-09-06T23:21:02.0000000Z error: unused variable foo",
    );
  });
});
