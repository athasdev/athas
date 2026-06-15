import { type RefObject, useCallback, useEffect, useRef } from "react";

const EDGE_MARGIN = 40;
const MAX_SCROLL_SPEED = 25;

let dragScrollActive = false;

export function isDragScrolling() {
  return dragScrollActive;
}

export function useDragScroll(textareaRef: RefObject<HTMLTextAreaElement | null>) {
  const isDraggingRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const mousePositionRef = useRef({ x: 0, y: 0 });

  const scrollTick = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea || !isDraggingRef.current) {
      rafRef.current = null;
      return;
    }

    const rect = textarea.getBoundingClientRect();
    const { x, y } = mousePositionRef.current;

    let scrollX = 0;
    let scrollY = 0;

    const distFromBottom = rect.bottom - y;
    const distFromTop = y - rect.top;
    const distFromRight = rect.right - x;
    const distFromLeft = x - rect.left;

    if (distFromBottom < EDGE_MARGIN && distFromBottom >= 0) {
      scrollY = Math.ceil(MAX_SCROLL_SPEED * (1 - distFromBottom / EDGE_MARGIN));
    } else if (distFromTop < EDGE_MARGIN && distFromTop >= 0) {
      scrollY = -Math.ceil(MAX_SCROLL_SPEED * (1 - distFromTop / EDGE_MARGIN));
    }

    if (distFromRight < EDGE_MARGIN && distFromRight >= 0) {
      scrollX = Math.ceil(MAX_SCROLL_SPEED * (1 - distFromRight / EDGE_MARGIN));
    } else if (distFromLeft < EDGE_MARGIN && distFromLeft >= 0) {
      scrollX = -Math.ceil(MAX_SCROLL_SPEED * (1 - distFromLeft / EDGE_MARGIN));
    }

    // Also scroll when the mouse is outside the textarea bounds
    if (y > rect.bottom) {
      scrollY = Math.ceil(MAX_SCROLL_SPEED * Math.min((y - rect.bottom) / EDGE_MARGIN + 1, 3));
    } else if (y < rect.top) {
      scrollY = -Math.ceil(MAX_SCROLL_SPEED * Math.min((rect.top - y) / EDGE_MARGIN + 1, 3));
    }

    if (x > rect.right) {
      scrollX = Math.ceil(MAX_SCROLL_SPEED * Math.min((x - rect.right) / EDGE_MARGIN + 1, 3));
    } else if (x < rect.left) {
      scrollX = -Math.ceil(MAX_SCROLL_SPEED * Math.min((rect.left - x) / EDGE_MARGIN + 1, 3));
    }

    if (scrollX !== 0 || scrollY !== 0) {
      textarea.scrollTop += scrollY;
      textarea.scrollLeft += scrollX;

      // Dispatch scroll event so overlay layers stay in sync
      textarea.dispatchEvent(new Event("scroll", { bubbles: true }));
    }

    rafRef.current = requestAnimationFrame(scrollTick);
  }, [textareaRef]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const handleMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      isDraggingRef.current = true;
      dragScrollActive = true;
      mousePositionRef.current = { x: e.clientX, y: e.clientY };
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      mousePositionRef.current = { x: e.clientX, y: e.clientY };

      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(scrollTick);
      }
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
      dragScrollActive = false;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };

    textarea.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      textarea.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [textareaRef, scrollTick]);
}
