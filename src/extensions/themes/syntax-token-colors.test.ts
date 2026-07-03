import { describe, expect, it } from "vite-plus/test";
import { normalizeSyntaxColors, toSyntaxTokenVariables } from "./syntax-token-colors";

describe("syntax token colors", () => {
  it("keeps theme syntax colors that do not collapse into foreground", () => {
    const syntax = normalizeSyntaxColors(
      {
        keyword: "#ff0080",
        function: "#0070f3",
        property: "#79ffe1",
        variable: "#f59e0b",
      },
      { text: "#ededed" },
      "dark",
    );

    expect(syntax.keyword).toBe("#ff0080");
    expect(syntax.function).toBe("#0070f3");
    expect(syntax.property).toBe("#79ffe1");
    expect(syntax.variable).toBe("#f59e0b");
  });

  it("rescues foreground-colored identifiers so TSX is not mostly plain text", () => {
    const syntax = normalizeSyntaxColors(
      {
        keyword: "#ff79c6",
        function: "#50fa7b",
        variable: "#f8f8f2",
        property: "#f8f8f2",
        punctuation: "#f8f8f2",
      },
      { text: "#f8f8f2" },
      "dark",
    );

    expect(syntax.keyword).toBe("#ff79c6");
    expect(syntax.function).toBe("#50fa7b");
    expect(syntax.variable).toBe("#c8a7db");
    expect(syntax.property).toBe("#93bde9");
    expect(syntax.punctuation).toBe("#9fa2aa");
  });

  it("rescues near-foreground syntax colors that look like plain text", () => {
    const syntax = normalizeSyntaxColors(
      {
        variable: "#e9edf2",
        property: "#edf1f6",
        function: "#7cc7ff",
      },
      { text: "#e6edf3" },
      "dark",
    );

    expect(syntax.variable).toBe("#c8a7db");
    expect(syntax.property).toBe("#93bde9");
    expect(syntax.function).toBe("#7cc7ff");
  });

  it("builds raw and tailwind-compatible variables from normalized syntax", () => {
    const variables = toSyntaxTokenVariables(
      {
        "--syntax-variable": "#ededed",
        "--color-syntax-property": "#ededed",
      },
      { text: "#ededed" },
      "dark",
    );

    expect(variables["--syntax-variable"]).toBe("#c8a7db");
    expect(variables["--color-syntax-variable"]).toBe("#c8a7db");
    expect(variables["--syntax-property"]).toBe("#93bde9");
    expect(variables["--color-syntax-property"]).toBe("#93bde9");
  });
});
