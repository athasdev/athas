import type { RefObject } from "react";
import { describe, expect, it } from "vite-plus/test";
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
