import type { RefObject } from "react";
import { describe, expect, it } from "vite-plus/test";
import { applyEditorScrollTransform } from "../utils/scroll-layers";

function layerRef(): RefObject<HTMLElement | null> {
  return {
    current: { style: { transform: "" } } as HTMLElement,
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
});
