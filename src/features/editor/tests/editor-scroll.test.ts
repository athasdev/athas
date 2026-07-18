import type { RefObject } from "react";
import { describe, expect, it } from "vite-plus/test";
import { getEditorBottomScrollPadding } from "../engines/monaco/scroll-padding";
import { applyEditorScrollTransform } from "../utils/scroll-layers";

function layerRef(dataset: Partial<DOMStringMap> = {}): RefObject<HTMLElement | null> {
  return {
    current: { dataset, style: { transform: "" } } as HTMLElement,
  };
}

describe("editor scroll layer sync", () => {
  it("applies one transform to every mounted scroll layer", () => {
    const first = layerRef();
    const second = layerRef();

    applyEditorScrollTransform([first, { current: null }, second], 12, 34);

    expect(first.current?.style.transform).toBe("translate(-12px, -34px)");
    expect(second.current?.style.transform).toBe("translate(-12px, -34px)");
  });

  it("keeps viewport-wide layers aligned horizontally", () => {
    const currentLine = layerRef({ editorScrollAxis: "y" });

    applyEditorScrollTransform([currentLine], 12, 34);

    expect(currentLine.current?.style.transform).toBe("translateY(-34px)");
  });
});

describe("editor bottom safe area", () => {
  it("keeps half of the viewport below the last line", () => {
    expect(getEditorBottomScrollPadding(800)).toBe(400);
    expect(getEditorBottomScrollPadding(721)).toBe(361);
  });

  it("disables padding when the viewport is unavailable", () => {
    expect(getEditorBottomScrollPadding(0)).toBe(0);
    expect(getEditorBottomScrollPadding(Number.NaN)).toBe(0);
  });
});
