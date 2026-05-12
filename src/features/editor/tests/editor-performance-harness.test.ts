import { describe, expect, it } from "vite-plus/test";
import {
  createEditorPerfFixture,
  evaluateEditorPerfBudgets,
  formatEditorPerfResult,
  runEditorPerformanceBenchmark,
} from "../performance/editor-performance-harness";

describe("editor performance harness", () => {
  it("creates deterministic large text fixtures", () => {
    const fixture = createEditorPerfFixture({
      fileType: "txt",
      lineCount: 3,
      lineLength: 12,
    });

    expect(fixture.fileType).toBe("txt");
    expect(fixture.lineCount).toBe(3);
    expect(fixture.content.split("\n")).toEqual(["line-0:xxxxx", "line-1:xxxxx", "line-2:xxxxx"]);
  });

  it("measures the core large-editor operations", () => {
    let timestamp = 0;
    const fixture = createEditorPerfFixture({
      lineCount: 20_000,
      lineLength: 18,
    });
    const result = runEditorPerformanceBenchmark({
      name: "unit-smoke",
      content: fixture.content,
      fileType: fixture.fileType,
      lineCount: fixture.lineCount,
      viewportLines: 50,
      scrollSteps: 4,
      pasteText: "paste\n",
      now: () => timestamp++,
    });

    expect(result.name).toBe("unit-smoke");
    expect(result.phases.map((phase) => phase.name)).toEqual([
      "open",
      "viewport",
      "scroll",
      "search",
      "wordHighlight",
      "click",
      "type",
      "paste",
    ]);
    expect(result.totalMs).toBe(8);
    expect(formatEditorPerfResult(result)).toContain(
      "[athas:editor-perf] scenario=unit-smoke type=txt lines=20000",
    );
  });

  it("reports budget failures without throwing", () => {
    const fixture = createEditorPerfFixture({ lineCount: 200, lineLength: 12 });
    const result = runEditorPerformanceBenchmark({
      content: fixture.content,
      lineCount: fixture.lineCount,
      now: (() => {
        let timestamp = 0;
        return () => {
          timestamp += 10;
          return timestamp;
        };
      })(),
    });

    expect(evaluateEditorPerfBudgets(result, { open: 1, total: 1 })).toEqual([
      { name: "open", actualMs: 10, budgetMs: 1 },
      { name: "total", actualMs: 80, budgetMs: 1 },
    ]);
  });
});
