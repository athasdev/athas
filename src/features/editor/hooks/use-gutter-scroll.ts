/**
 * Sync gutter scroll with editor
 */

import { type RefObject, useEffect } from "react";

export function useGutterScroll(
  editorRef: RefObject<HTMLElement | null>,
  gutterRef: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    const editor = editorRef.current;
    const gutter = gutterRef.current;
    if (!editor || !gutter) return;

    const sync = () => {
      gutter.scrollTop = editor.scrollTop;
    };

    editor.addEventListener("scroll", sync);
    return () => editor.removeEventListener("scroll", sync);
  }, [editorRef, gutterRef]);
}
