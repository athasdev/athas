import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import { Slider } from "@/ui/slider";

describe("Stepped slider", () => {
  it("marks every stop and reports the selected step", () => {
    const markup = renderToStaticMarkup(
      <Slider value={1} onValueChange={() => {}} max={3} ticks aria-label="Reasoning effort" />,
    );

    expect(markup).toContain('aria-label="Reasoning effort"');
    expect(markup).toContain('aria-valuenow="1"');
    expect(markup).toContain('max="3"');
    expect(markup.match(/rounded-full bg-foreground\/25/g)).toHaveLength(4);
  });

  it("keeps the stops aligned with the inset thumb travel", () => {
    const markup = renderToStaticMarkup(
      <Slider value={0} onValueChange={() => {}} max={1} ticks aria-label="Effort" />,
    );

    expect(markup).toContain("left:calc(1.25rem / 2 + (100% - 1.25rem) * 0)");
    expect(markup).toContain("left:calc(1.25rem / 2 + (100% - 1.25rem) * 1)");
  });

  it("omits the stop dots when they would crowd the track", () => {
    const markup = renderToStaticMarkup(
      <Slider value={5} onValueChange={() => {}} max={100} ticks aria-label="Effort" />,
    );

    expect(markup).not.toContain("bg-foreground/25");
  });
});
