import { describe, expect, it } from "vite-plus/test";
import {
  getStructuredToolViews,
  isStructuredToolViewEnvelope,
  stripStructuredToolViews,
} from "@/features/ai/lib/structured-tool-view";

const metricView = {
  type: "metric" as const,
  label: "Passing",
  value: 18,
};

describe("structured tool views", () => {
  it("extracts and removes a standalone Athas UI envelope", () => {
    const output = { type: "athas_ui", view: metricView };

    expect(isStructuredToolViewEnvelope(output)).toBe(true);
    expect(getStructuredToolViews(output)).toEqual([metricView]);
    expect(stripStructuredToolViews(output)).toBeUndefined();
  });

  it("extracts multiple views while preserving regular ACP output", () => {
    const textOutput = {
      type: "content",
      content: { type: "text", text: "Build finished" },
    };
    const diffOutput = {
      type: "diff",
      path: "src/main.ts",
      oldText: "old",
      newText: "new",
    };
    const calloutView = {
      type: "callout" as const,
      title: "Ready",
      tone: "success" as const,
    };
    const output = [
      textOutput,
      { type: "athas_ui", view: metricView },
      diffOutput,
      { type: "athas_ui", view: calloutView },
    ];

    expect(getStructuredToolViews(output)).toEqual([metricView, calloutView]);
    expect(stripStructuredToolViews(output)).toEqual([textOutput, diffOutput]);
  });

  it("leaves outputs without Athas UI envelopes unchanged", () => {
    const output = { type: "content", content: { type: "text", text: "Done" } };

    expect(isStructuredToolViewEnvelope(output)).toBe(false);
    expect(getStructuredToolViews(output)).toEqual([]);
    expect(stripStructuredToolViews(output)).toBe(output);
  });

  it("does not accept envelopes without a view", () => {
    const output = { type: "athas_ui" };

    expect(isStructuredToolViewEnvelope(output)).toBe(false);
    expect(getStructuredToolViews(output)).toEqual([]);
  });
});
