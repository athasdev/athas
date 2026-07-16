import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import { Tab, TabBarSurface, TabBarTab, TabsList } from "../tabs";

function rootClassTokens(markup: string): Set<string> {
  const match = markup.match(/^<div[^>]*class="([^"]*)"/);
  return new Set(match?.[1]?.split(/\s+/) ?? []);
}

describe("tab primitives", () => {
  it.each(["default", "pill", "segmented", "connected"] as const)(
    "keeps the %s tab variant borderless",
    (variant) => {
      const tokens = rootClassTokens(
        renderToStaticMarkup(
          <Tab isActive variant={variant}>
            File
          </Tab>,
        ),
      );

      expect(tokens).not.toContain("border");
      expect(tokens).not.toContain("border-border");
    },
  );

  it("renders connected tabs as a borderless active surface", () => {
    const markup = renderToStaticMarkup(
      <Tab isActive variant="connected">
        File
      </Tab>,
    );
    const tokens = rootClassTokens(markup);

    expect(tokens).toContain("ui-connected-tab");
    expect(tokens).toContain("bg-tab-active");
    expect(tokens).toContain("border-0");
    expect(tokens).not.toContain("border");
    expect(tokens).not.toContain("border-border");
  });

  it("keeps connected tab chrome free of separator borders", () => {
    const tokens = rootClassTokens(renderToStaticMarkup(<TabBarSurface />));

    expect(tokens).toContain("bg-tab-bar");
    expect(tokens).toContain("h-9");
    expect(tokens).not.toContain("border-b");
  });

  it("keeps selector tab lists borderless", () => {
    const tokens = rootClassTokens(renderToStaticMarkup(<TabsList variant="segmented" />));

    expect(tokens).toContain("bg-secondary-bg/55");
    expect(tokens).not.toContain("border");
  });

  it("does not constrain vertical tab-bar items with an inline maximum width", () => {
    const markup = renderToStaticMarkup(
      <TabBarTab orientation="vertical" isActive>
        Terminal
      </TabBarTab>,
    );

    expect(markup).not.toContain("max-width");
  });
});
