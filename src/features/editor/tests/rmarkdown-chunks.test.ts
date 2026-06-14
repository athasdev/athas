import { describe, expect, it } from "vite-plus/test";
import { getRMarkdownChunks } from "../notebook/rmarkdown-chunks";

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
});
