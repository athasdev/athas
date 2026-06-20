import { describe, expect, it } from "vite-plus/test";
import {
  applyRMarkdownChunkOptionSemantics,
  clearRMarkdownChunkOutput,
  formatRMarkdownChunkOutput,
  getRMarkdownChunks,
  rMarkdownChunkShouldEvaluate,
  rMarkdownChunkShouldPersistOutput,
  updateRMarkdownChunkOutput,
} from "../notebook/rmarkdown-chunks";

describe("R Markdown chunks", () => {
  it("finds R chunks and carries previous chunks as setup", () => {
    const content = [
      "---",
      "title: Report",
      "---",
      "",
      "```{r setup}",
      "library(stats)",
      "```",
      "",
      "Text",
      "",
      "```{r model, echo=FALSE}",
      "fit <- lm(mpg ~ wt, data = mtcars)",
      "summary(fit)",
      "```",
      "",
    ].join("\n");

    const chunks = getRMarkdownChunks(content);

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toMatchObject({
      index: 0,
      markerLine: 4,
      startLine: 5,
      title: "setup",
      language: "r",
      code: "library(stats)",
      setupCode: "",
    });
    expect(chunks[1]).toMatchObject({
      index: 1,
      markerLine: 10,
      startLine: 11,
      title: "model",
      language: "r",
      code: "fit <- lm(mpg ~ wt, data = mtcars)\nsummary(fit)",
      setupCode: "library(stats)",
    });
  });

  it("supports plain r fences and ignores non-R fences", () => {
    const content = ["```python", "print('skip')", "```", "", "```r", "1 + 1", "```"].join("\n");

    expect(getRMarkdownChunks(content)).toEqual([
      expect.objectContaining({
        index: 0,
        markerLine: 4,
        title: "r chunk 1",
        code: "1 + 1",
      }),
    ]);
  });

  it("adds persistent output after the executed chunk", () => {
    const content = ["Text", "", "```{r model}", "1 + 1", "```", "", "More text"].join("\n");
    const [chunk] = getRMarkdownChunks(content);

    const nextContent = updateRMarkdownChunkOutput(
      content,
      chunk,
      formatRMarkdownChunkOutput({ stdout: "[1] 2\n", stderr: "", status: 0, timedOut: false }),
    );

    expect(nextContent).toBe(
      [
        "Text",
        "",
        "```{r model}",
        "1 + 1",
        "```",
        "<!-- athas:r-output:start -->",
        "````text",
        "[1] 2",
        "````",
        "<!-- athas:r-output:end -->",
        "",
        "More text",
      ].join("\n"),
    );
  });

  it("replaces existing persistent output for the same chunk", () => {
    const content = [
      "```{r model}",
      "1 + 1",
      "```",
      "<!-- athas:r-output:start -->",
      "````text",
      "[1] 2",
      "````",
      "<!-- athas:r-output:end -->",
      "",
    ].join("\n");
    const [chunk] = getRMarkdownChunks(content);

    const nextContent = updateRMarkdownChunkOutput(
      content,
      chunk,
      formatRMarkdownChunkOutput({ stdout: "[1] 3\n", stderr: "", status: 0, timedOut: false }),
    );

    expect(nextContent).toContain("[1] 3");
    expect(nextContent).not.toContain("[1] 2");
    expect(nextContent.match(/athas:r-output:start/g)).toHaveLength(1);
  });

  it("persists errors and timeouts as output blocks", () => {
    expect(
      formatRMarkdownChunkOutput({
        stdout: "",
        stderr: "Error: object 'x' not found\n",
        status: 1,
        timedOut: false,
      }),
    ).toContain("stderr:\nError: object 'x' not found");

    expect(
      formatRMarkdownChunkOutput({
        stdout: "",
        stderr: "",
        status: null,
        timedOut: true,
      }),
    ).toContain("stderr:\nR chunk execution timed out.");
  });

  it("parses chunk options used by execution semantics", () => {
    const content = [
      "```{r model, eval=FALSE, include=FALSE, results='hide', warning=FALSE, message=FALSE, error=TRUE}",
      "stop('kept')",
      "```",
    ].join("\n");
    const [chunk] = getRMarkdownChunks(content);

    expect(chunk.title).toBe("model");
    expect(chunk.options).toMatchObject({
      label: "model",
      eval: false,
      include: false,
      results: "hide",
      warning: false,
      message: false,
      error: true,
    });
    expect(rMarkdownChunkShouldEvaluate(chunk)).toBe(false);
    expect(rMarkdownChunkShouldPersistOutput(chunk)).toBe(false);
  });

  it("applies output options before formatting chunk output", () => {
    const [resultsHidden] = getRMarkdownChunks(
      ["```{r model, results='hide', warning=FALSE}", "warning('skip')", "1 + 1", "```"].join("\n"),
    );

    expect(
      applyRMarkdownChunkOptionSemantics(
        {
          stdout: "[1] 2\n",
          stderr: "Warning message:\nskip\n",
          status: 0,
          timedOut: false,
        },
        resultsHidden,
      ),
    ).toMatchObject({
      stdout: "",
      stderr: "",
    });

    const [messagesHidden] = getRMarkdownChunks(
      ["```{r model, message=FALSE}", "message('skip')", "```"].join("\n"),
    );

    expect(
      applyRMarkdownChunkOptionSemantics(
        {
          stdout: "",
          stderr: "skip\n",
          status: 0,
          timedOut: false,
        },
        messagesHidden,
      ).stderr,
    ).toBe("");
  });

  it("clears persistent output for hidden chunks", () => {
    const content = [
      "```{r model, include=FALSE}",
      "1 + 1",
      "```",
      "<!-- athas:r-output:start -->",
      "````text",
      "[1] 2",
      "````",
      "<!-- athas:r-output:end -->",
      "",
      "More text",
    ].join("\n");
    const [chunk] = getRMarkdownChunks(content);

    const nextContent = clearRMarkdownChunkOutput(content, chunk);

    expect(nextContent).not.toContain("athas:r-output");
    expect(nextContent).toContain("More text");
  });
});
