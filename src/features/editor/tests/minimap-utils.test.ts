import { describe, expect, it } from "vite-plus/test";
import {
  bucketTokensByLine,
  buildSearchMarks,
  getLineIndexAtOffset,
  getMinimapHorizontalMetrics,
  getMinimapRenderMetrics,
  getScrollTopFromMinimapY,
} from "../components/minimap/minimap-utils";

describe("minimap utils", () => {
  it("finds the line index for a character offset", () => {
    expect(getLineIndexAtOffset([0, 4, 8], 5)).toBe(1);
  });

  it("buckets tokens across the lines they touch", () => {
    const lines = ["abc", "def"];
    const lineStarts = [0, 4];
    const tokens = [{ start: 2, end: 6, class_name: "token-string" }];
    const buckets = bucketTokensByLine(tokens, lineStarts, lines);

    expect(buckets.get(0)).toEqual(tokens);
    expect(buckets.get(1)).toEqual(tokens);
  });

  it("scales minimap text horizontally to the available width", () => {
    const metrics = getMinimapHorizontalMetrics({
      lines: ["short", "const value = makeSomethingReadable();"],
      width: 100,
      horizontalPadding: 2,
    });

    expect(metrics.contentWidth).toBe(96);
    expect(metrics.charWidth).toBeGreaterThan(1);
    expect(metrics.charWidth).toBeLessThanOrEqual(1.35);
  });

  it("keeps long minimap lines readable instead of applying vertical scale to x positions", () => {
    const metrics = getMinimapHorizontalMetrics({
      lines: ["x".repeat(400)],
      width: 100,
      horizontalPadding: 2,
    });

    expect(metrics.charWidth).toBe(0.45);
  });

  it("handles many lines without spreading them into Math.max", () => {
    const metrics = getMinimapHorizontalMetrics({
      lines: Array.from({ length: 120_000 }, (_, index) => (index === 42 ? "x".repeat(80) : "x")),
      width: 160,
      horizontalPadding: 0,
    });

    expect(metrics.charWidth).toBe(1.35);
  });

  it("compresses long documents to the available minimap height", () => {
    const metrics = getMinimapRenderMetrics({
      preferredScale: 0.15,
      totalHeight: 10_000,
      viewportHeight: 500,
      scrollTop: 1_000,
      containerHeight: 400,
    });

    expect(metrics.renderHeight).toBe(400);
    expect(metrics.renderScale).toBe(0.04);
    expect(metrics.viewportTop).toBe(40);
    expect(metrics.viewportHeight).toBe(20);
  });

  it("maps pointer y positions back to clamped editor scroll", () => {
    expect(
      getScrollTopFromMinimapY({
        y: 100,
        renderScale: 0.1,
        viewportHeight: 200,
        totalHeight: 2_000,
      }),
    ).toBe(900);
  });

  it("projects search matches to minimap marks", () => {
    expect(
      buildSearchMarks({
        matches: [{ start: 7, end: 9 }],
        currentMatchIndex: 0,
        lineStarts: [0, 6, 11],
        lineHeight: 20,
        renderScale: 0.2,
      }),
    ).toEqual([{ top: 4, active: true }]);
  });
});
