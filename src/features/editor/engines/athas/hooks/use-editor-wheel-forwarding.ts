import { useEffect, type RefObject } from "react";

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
    if (largeContentMode || !scrollable) return;

    const textarea = textareaRef.current;
    if (!textarea) return;

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
