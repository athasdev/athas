import { EditorView } from "@codemirror/view";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { addEditorSelectionsToAgentChat } from "@/features/ai/lib/add-selection-to-agent-chat";
import type { EditorSelectionContext } from "@/features/ai/types/ai-context.types";
import { EditorSelectionAgentAction } from "../../../components/selection/editor-selection-agent-action";
import { useBufferStore } from "../../../stores/buffer.store";
import { useInlineEditToolbarStore } from "../../../stores/inline-edit-toolbar.store";
import { getBufferById } from "../../../utils/buffer-index";
import { createEditorSelectionContextFromText } from "../../../utils/editor-agent-context";
import { type CodeMirrorHost, useCodeMirrorExtension } from "../host";
import { toEditorRange } from "../position";
import { BREAKPOINT_GUTTER_CLASS } from "./breakpoints";

interface SelectionAgentActionState {
  anchorRect: { x: number; y: number; width: number; height: number };
  context: EditorSelectionContext;
}

/**
 * The selection toolbar shown above selected text once the pointer lets go: Edit opens inline
 * edit on the selection, and the chat button adds it to the agent chat.
 */
export function CodeMirrorSelectionAgentAction({ host }: { host: CodeMirrorHost }) {
  const { view, bufferId, isActiveSurface, isReadOnly } = host;
  const languageId = host.languageId;
  const inlineEditRequested = useInlineEditToolbarStore.use.isVisible();
  const bufferPath = useBufferStore(
    useCallback((state) => getBufferById(state.buffers, bufferId)?.path ?? "", [bufferId]),
  );
  const bufferName = useBufferStore(
    useCallback((state) => getBufferById(state.buffers, bufferId)?.name ?? "", [bufferId]),
  );
  const [action, setAction] = useState<SelectionAgentActionState | null>(null);
  const lastKeyRef = useRef<string | null>(null);
  const isPointerSelectingRef = useRef(false);
  const separatorRef = useRef(host.getSeparator);
  useLayoutEffect(() => {
    separatorRef.current = host.getSeparator;
  });

  const clearAction = useCallback(() => {
    lastKeyRef.current = null;
    setAction(null);
  }, []);

  // Runs on scroll, cursor and content changes while text is selected, so it reads only the
  // selected range and leaves state alone when neither the selection nor its anchor moved.
  const syncAction = useCallback(() => {
    const { state } = view;
    const main = state.selection.main;
    if (
      !isActiveSurface ||
      isPointerSelectingRef.current ||
      isReadOnly ||
      inlineEditRequested ||
      main.empty
    ) {
      clearAction();
      return;
    }

    const separator = separatorRef.current();
    const editorRange = toEditorRange(state.doc, main, separator);
    const context = editorRange
      ? createEditorSelectionContextFromText(
          { id: bufferId, path: bufferPath, name: bufferName },
          editorRange,
          state.doc.sliceString(main.from, main.to, separator),
          languageId || "text",
        )
      : null;
    if (!context) {
      clearAction();
      return;
    }

    const start = view.coordsAtPos(main.from, 1);
    const end = view.coordsAtPos(main.to, -1);
    const visible = start ?? end;
    if (!visible) {
      clearAction();
      return;
    }

    const isSingleVisibleLine =
      state.doc.lineAt(main.from).number === state.doc.lineAt(main.to).number && start && end;
    const left = isSingleVisibleLine ? Math.min(start.left, end.left) : visible.left;
    const width = isSingleVisibleLine ? Math.max(Math.abs(end.left - start.left), 1) : 1;
    const anchorRect = {
      x: left,
      y: visible.top,
      width,
      height: visible.bottom - visible.top,
    };
    const key = `${context.id}:${Math.round(anchorRect.x)}:${Math.round(anchorRect.y)}:${Math.round(width)}`;
    if (lastKeyRef.current === key) return;
    lastKeyRef.current = key;
    setAction({ anchorRect, context });
  }, [
    bufferId,
    bufferName,
    bufferPath,
    clearAction,
    inlineEditRequested,
    isActiveSurface,
    isReadOnly,
    languageId,
    view,
  ]);

  const syncActionRef = useRef(syncAction);
  useLayoutEffect(() => {
    syncActionRef.current = syncAction;
  }, [syncAction]);

  useEffect(() => {
    syncAction();
  }, [syncAction]);

  const extension = useMemo(
    () =>
      EditorView.updateListener.of((update) => {
        if (update.docChanged || update.selectionSet || update.geometryChanged) {
          syncActionRef.current();
        }
      }),
    [],
  );
  useCodeMirrorExtension(view, extension);

  useEffect(() => {
    const scroller = view.scrollDOM;
    const handleScroll = () => syncActionRef.current();
    const handleMouseDown = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest(`.${BREAKPOINT_GUTTER_CLASS}`)) {
        return;
      }
      isPointerSelectingRef.current = true;
      clearAction();
    };
    const handleMouseUp = () => {
      if (!isPointerSelectingRef.current) return;
      isPointerSelectingRef.current = false;
      syncActionRef.current();
    };
    scroller.addEventListener("scroll", handleScroll, { passive: true });
    view.dom.addEventListener("mousedown", handleMouseDown, true);
    window.addEventListener("mouseup", handleMouseUp, true);
    return () => {
      scroller.removeEventListener("scroll", handleScroll);
      view.dom.removeEventListener("mousedown", handleMouseDown, true);
      window.removeEventListener("mouseup", handleMouseUp, true);
    };
  }, [clearAction, view]);

  if (!action) return null;

  return (
    <EditorSelectionAgentAction
      anchorRect={action.anchorRect}
      onClose={clearAction}
      onEdit={() => {
        clearAction();
        useInlineEditToolbarStore.getState().actions.show(host.viewStateKey ?? bufferId);
      }}
      onAddToChat={() => {
        addEditorSelectionsToAgentChat([action.context]);
        clearAction();
      }}
    />
  );
}
