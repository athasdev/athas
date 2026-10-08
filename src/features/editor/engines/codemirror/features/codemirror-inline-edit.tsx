import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, type RefObject } from "react";
import { useOnClickOutside } from "usehooks-ts";
import { InlineEditPopover } from "@/features/ai/inline-edit/components/inline-edit-popover";
import type { InlineEditPreview } from "../../../types/inline-edit-preview.types";
import { useInlineEdit } from "@/features/ai/inline-edit/hooks/use-inline-edit";
import { useBufferText } from "../../../hooks/use-buffer-text";
import { useEditorViewSettings } from "../../../hooks/use-editor-view-settings";
import { useShallow } from "zustand/react/shallow";
import type { PaneContent } from "@/features/panes/types/pane-content.types";
import { useBufferStore } from "../../../stores/buffer.store";
import { useInlineEditToolbarStore } from "../../../stores/inline-edit-toolbar.store";
import { useEditorStateStore } from "../../../stores/state.store";
import type { Range } from "../../../types/editor.types";
import { getBufferById } from "../../../stores/buffer-index";
import { type CodeMirrorHost, useCodeMirrorExtension } from "../host";
import { fromEditorPosition, toEditorPosition } from "../position";
import {
  applyCodeMirrorInlineEdit,
  inlineEditPreviewExtension,
  showCodeMirrorInlineEditPreview,
} from "./inline-edit-preview";

/** Inline edit (Cmd+K) in a CodeMirror editor: the popover, its diff preview and the apply. */
export function CodeMirrorInlineEdit({ host }: { host: CodeMirrorHost }) {
  const { view, container, bufferId } = host;
  const separatorRef = useRef(host.getSeparator);
  useLayoutEffect(() => {
    separatorRef.current = host.getSeparator;
  });
  useCodeMirrorExtension(view, inlineEditPreviewExtension);

  const { fontSize, fontFamily, lineHeight, tabSize } = useEditorViewSettings();
  const inlineEditRequested = useInlineEditToolbarStore.use.isVisible();
  // The text only matters while inline edit is open; following it otherwise re-rendered this
  // feature on every keystroke.
  const buffer = useBufferStore(
    useShallow(
      useCallback(
        (state: { buffers: PaneContent[] }) => {
          const found = getBufferById(state.buffers, bufferId);
          if (found?.type !== "editor") return null;
          return { id: found.id, path: found.path };
        },
        [bufferId],
      ),
    ),
  );
  const inlineEditContent = useBufferText(inlineEditRequested ? bufferId : null);
  const selection = useEditorStateStore((state) =>
    host.isActiveSurface && inlineEditRequested ? state.selection : undefined,
  );
  const { setCursorPosition, setSelection } = useEditorStateStore.use.actions();
  const lastScrollRef = useRef({ top: 0, left: 0 });

  const resolveModelPosition = useCallback(
    (line: number, column: number) => {
      const { doc } = view.state;
      const position = fromEditorPosition(doc, { line, column, offset: 0 });
      const containerRect = container.getBoundingClientRect();
      const coords = view.coordsAtPos(position, 1) ?? view.coordsAtPos(position, -1);
      const top = view.documentTop + view.lineBlockAt(position).top - containerRect.top;
      const left = coords
        ? coords.left - containerRect.left
        : view.contentDOM.getBoundingClientRect().left -
          containerRect.left +
          (position - doc.lineAt(position).from) * view.defaultCharacterWidth;
      return { top, left };
    },
    [container, view],
  );

  const getCursorOffset = useCallback(
    () =>
      toEditorPosition(view.state.doc, view.state.selection.main.head, separatorRef.current())
        .offset,
    [view],
  );

  const getSelectionAnchor = useCallback(() => {
    const { line, column } = toEditorPosition(
      view.state.doc,
      view.state.selection.main.head,
      separatorRef.current(),
    );
    return { line, column };
  }, [view]);

  const getViewportMetrics = useCallback(
    () => ({
      scrollTop: 0,
      scrollLeft: 0,
      viewportWidth: container.clientWidth,
      viewportHeight: container.clientHeight,
    }),
    [container],
  );

  const applyInlineEdit = useCallback(
    (edit: { range: Range; editedText: string }) => {
      applyCodeMirrorInlineEdit(view, edit, separatorRef.current());
    },
    [view],
  );

  const previewInlineEdit = useCallback(
    (preview: InlineEditPreview) =>
      showCodeMirrorInlineEditPreview(view, preview, separatorRef.current()),
    [view],
  );

  const inlineEditState = useInlineEdit({
    enabled: host.isActiveSurface && !host.isReadOnly,
    viewKey: host.viewStateKey ?? bufferId,
    buffer: buffer
      ? {
          id: buffer.id,
          content: inlineEditContent,
          path: buffer.path,
          language: host.languageId ?? "",
        }
      : undefined,
    selection,
    fontSize,
    fontFamily,
    lineHeight,
    tabSize,
    lastScrollRef,
    resolveModelPosition,
    getCursorOffset,
    getSelectionAnchor,
    getViewportMetrics,
    applyInlineEdit,
    previewInlineEdit,
    setCursorPosition,
    setSelection,
  });

  // The popover is placed from editor coordinates, so it follows the text as the editor scrolls.
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  const { inlineEditVisible } = inlineEditState;
  useEffect(() => {
    if (!inlineEditVisible) return;
    const scroller = view.scrollDOM;
    scroller.addEventListener("scroll", rerender, { passive: true });
    return () => scroller.removeEventListener("scroll", rerender);
  }, [inlineEditVisible, view]);

  useOnClickOutside(inlineEditState.inlineEditPopoverRef as RefObject<HTMLElement>, (event) => {
    if (!inlineEditState.inlineEditVisible) return;
    const target = event.target as HTMLElement | null;
    // The model menu opens in a portal outside the popover.
    if (
      target?.closest(
        '[data-slot="dropdown-menu-content"], [data-slot="dropdown-menu-sub-content"]',
      )
    ) {
      return;
    }
    inlineEditState.inlineEditToolbarActions.hide();
  });

  return <InlineEditPopover state={inlineEditState} selection={selection} />;
}
