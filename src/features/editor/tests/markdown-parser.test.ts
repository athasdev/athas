import { describe, expect, it, vi } from "vite-plus/test";
import { parseMarkdown } from "../markdown/parser";

vi.mock("dompurify", () => ({
  default: {
    sanitize: (html: string) => html,
  },
}));

describe("parseMarkdown", () => {
  it("renders YAML front matter as preview properties", () => {
    const html = parseMarkdown(`---
title: Research Analysis Report
description: Reproducible analysis workflow
author: Athas Highlighting Check
date: 2026-06-11
output: html_document
params:
  min_score: 0.25
---

# Summary

Body text`);

    expect(html).toContain("<h1>Summary</h1>");
    expect(html).toContain("<p>Body text</p>");
    expect(html).toContain("Document properties");
    expect(html).toContain('class="markdown-front-matter-heading">Research Analysis Report</div>');
    expect(html).toContain(
      'class="markdown-front-matter-description">Reproducible analysis workflow</p>',
    );
    expect(html).not.toContain("<dt>title</dt>");
    expect(html).not.toContain("<dt>description</dt>");
    expect(html).not.toContain("<dt>params</dt>");
    expect(html).toContain("<dt>output</dt><dd>html_document</dd>");
    expect(html).toContain("<dt>params.min_score</dt><dd>0.25</dd>");
    expect(html).not.toContain("<hr />");
  });

  it("keeps thematic breaks outside the first front matter block", () => {
    expect(parseMarkdown("# Title\n\n---\n\nBody")).toContain("<hr />");
  });

  it("normalizes R Markdown chunk info strings to language classes", () => {
    const html = parseMarkdown("```{r setup}\nlibrary(dplyr)\n```\n\n```python\nprint('ok')\n```");

    expect(html).toContain('class="language-r"');
    expect(html).toContain('class="language-python"');
    expect(html).not.toContain("language-{r setup}");
  });
});
