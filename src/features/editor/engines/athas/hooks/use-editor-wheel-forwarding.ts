import { useEffect, type RefObject } from "react";

export function resolveEditorWheelIntent({
  deltaX,
  deltaY,
  shiftKey,
}: {
  deltaX: number;
  deltaY: number;
  shiftKey: boolean;
}) {
  const isHorizontalIntent = shiftKey || Math.abs(deltaX) > Math.abs(deltaY);
  const deltaTop = isHorizontalIntent ? 0 : deltaY;
  const deltaLeft =
    isHorizontalIntent && shiftKey && Math.abs(deltaY) > Math.abs(deltaX)
      ? deltaY
      : isHorizontalIntent
        ? deltaX
        : 0;

  return { deltaTop, deltaLeft, isHorizontalIntent };
}

function canScrollByDelta(element: HTMLElement, axis: "x" | "y", delta: number): boolean {
  if (delta === 0) return false;

  if (axis === "y") {
    return (
      (delta < 0 && element.scrollTop > 0) ||
      (delta > 0 && element.scrollTop + element.clientHeight < element.scrollHeight)
    );
  }

  return (
    (delta < 0 && element.scrollLeft > 0) ||
    (delta > 0 && element.scrollLeft + element.clientWidth < element.scrollWidth)
  );
}

export function useEditorWheelForwarding({
  textareaRef,
  largeContentMode,
  scrollable,
}: {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  largeContentMode: boolean;
  scrollable: boolean;
}) {
  useEffect(() => {
    if (largeContentMode) return;

    const textarea = textareaRef.current;
    if (!textarea) return;

    if (!scrollable) {
      const scrollContainer =
        textarea.closest("[data-editor-outer-scroll]") ??
        textarea.closest("[data-diff-stack-scroll-container]");
      if (!(scrollContainer instanceof HTMLElement)) return;

      const handleWheel = (event: WheelEvent) => {
        const { deltaTop, deltaLeft } = resolveEditorWheelIntent(event);
        const canScrollY = canScrollByDelta(scrollContainer, "y", deltaTop);
        const canScrollX = canScrollByDelta(scrollContainer, "x", deltaLeft);

        if (textarea.scrollTop !== 0) {
          textarea.scrollTop = 0;
        }

        if (!canScrollY && !canScrollX) {
          if (deltaTop !== 0 || deltaLeft !== 0) {
            event.preventDefault();
            event.stopPropagation();
          }
          return;
        }

        if (canScrollY) {
          scrollContainer.scrollTop += deltaTop;
        }
        if (canScrollX) {
          scrollContainer.scrollLeft += deltaLeft;
        }
        event.preventDefault();
        event.stopPropagation();
      };

      textarea.addEventListener("wheel", handleWheel, { passive: false });
      return () => textarea.removeEventListener("wheel", handleWheel);
    }

    if (typeof navigator !== "undefined" && navigator.userAgent.includes("Mac")) {
      return;
    }

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();

      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        textarea.scrollLeft += event.deltaX;
      } else {
        textarea.scrollTop += event.deltaY;
      }
    };

    textarea.addEventListener("wheel", handleWheel, { passive: false });
    return () => textarea.removeEventListener("wheel", handleWheel);
  }, [largeContentMode, scrollable, textareaRef]);
}
