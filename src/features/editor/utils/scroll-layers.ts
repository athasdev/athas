import type { RefObject } from "react";

export type ScrollLayerRef = RefObject<HTMLElement | null>;

export function applyEditorScrollTransform(
  scrollLayerRefs: readonly ScrollLayerRef[],
  scrollLeft: number,
  scrollTop: number,
) {
  const transform = `translate(-${scrollLeft}px, -${scrollTop}px)`;

  for (const ref of scrollLayerRefs) {
    if (ref.current) {
      ref.current.style.transform = transform;
    }
  }
}
