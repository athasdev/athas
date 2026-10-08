import { EditorView } from "@codemirror/view";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useLspStore } from "../../../lsp/stores/lsp.store";
import type { JumpListEntry } from "../../../stores/jump-list.store";
import { type CodeMirrorHost, useCodeMirrorExtension } from "../host";
import { toEditorPosition } from "../position";

/**
 * Changes whenever the language servers start or stop, or a document opens or closes on them.
 * It does not follow edits; pair it with `useDebouncedLspRefresh` for state that edits change.
 */
export function useLspRevision(): string {
  return useLspStore((state) => {
    const { status, activeWorkspaces, documentRevision } = state.lspStatus;
    return `${status}:${activeWorkspaces.join("|")}:${documentRevision}`;
  });
}

/**
 * Runs `refresh` `delayMs` after `key` changes and after edits to the view's document pause.
 * Edits only re-arm a timer, so typing does not re-render React. `isCurrent` turns false once a
 * later refresh is armed or the hook is torn down, so a slow response cannot land late.
 */
export function useDebouncedLspRefresh(
  view: EditorView,
  enabled: boolean,
  key: string,
  delayMs: number,
  refresh: (isCurrent: () => boolean) => void,
) {
  const refreshRef = useRef(refresh);
  useLayoutEffect(() => {
    refreshRef.current = refresh;
  });
  const scheduleRef = useRef<(() => void) | null>(null);

  const extension = useMemo(
    () =>
      enabled
        ? EditorView.updateListener.of((update) => {
            if (update.docChanged) scheduleRef.current?.();
          })
        : null,
    [enabled],
  );
  useCodeMirrorExtension(view, extension);

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let generation = 0;
    let disposed = false;
    const schedule = () => {
      if (timer !== null) clearTimeout(timer);
      const scheduled = ++generation;
      timer = setTimeout(() => {
        timer = null;
        refreshRef.current(() => !disposed && generation === scheduled);
      }, delayMs);
    };
    scheduleRef.current = schedule;
    schedule();
    return () => {
      disposed = true;
      if (timer !== null) clearTimeout(timer);
      if (scheduleRef.current === schedule) scheduleRef.current = null;
    };
  }, [delayMs, enabled, key, view]);
}

/** Where a jump from `position` in the host's editor starts, for Go Back. */
export function jumpOrigin(
  host: CodeMirrorHost,
  view: EditorView,
  position: number,
): Omit<JumpListEntry, "timestamp"> {
  return {
    bufferId: host.bufferId,
    filePath: host.filePath,
    ...toEditorPosition(view.state.doc, position, host.getSeparator()),
    scrollTop: view.scrollDOM.scrollTop,
    scrollLeft: view.scrollDOM.scrollLeft,
  };
}
