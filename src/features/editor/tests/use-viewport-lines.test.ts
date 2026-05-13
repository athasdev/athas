import { describe, expect, it } from "vite-plus/test";
import {
  calculateViewportRangeForScroll,
  expandViewportRange,
  shouldUpdateViewportRange,
} from "../hooks/use-viewport-lines";

describe("useViewportLines", () => {
  it("expands the visible range when the editor viewport gets taller", () => {
    expect(
      calculateViewportRangeForScroll({
        scrollTop: 400,
        containerHeight: 400,
        totalLines: 150_000,
        lineHeight: 20,
        bufferLines: 0,
      }),
    ).toEqual({
      startLine: 20,
      endLine: 40,
      totalLines: 150_000,
    });

    expect(
      calculateViewportRangeForScroll({
        scrollTop: 400,
        containerHeight: 900,
        totalLines: 150_000,
        lineHeight: 20,
        bufferLines: 0,
      }),
    ).toEqual({
      startLine: 20,
      endLine: 65,
      totalLines: 150_000,
    });
  });

  it("updates no-buffer large-file rendering on single-line scroll changes", () => {
    expect(
      shouldUpdateViewportRange({
        previousRange: {
          startLine: 392,
          endLine: 424,
          totalLines: 150_000,
        },
        nextRange: {
          startLine: 393,
          endLine: 425,
          totalLines: 150_000,
        },
        bufferLines: 0,
      }),
    ).toBe(true);
  });

  it("adds render overscan without moving the underlying viewport", () => {
    expect(
      expandViewportRange(
        {
          startLine: 392,
          endLine: 429,
          totalLines: 150_000,
        },
        150_000,
        80,
      ),
    ).toEqual({
      startLine: 312,
      endLine: 509,
      totalLines: 150_000,
    });
  });
});
