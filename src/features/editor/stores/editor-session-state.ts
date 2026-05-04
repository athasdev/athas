import type { EditorContent } from "@/features/panes/types/pane-content";
import type { PersistedEditorViewState } from "../types/editor-session";
import { useFoldStore } from "./fold-store";
import { useEditorStateStore, type EditorViewState } from "./state-store";

const hasPersistedEditorViewState = (state: PersistedEditorViewState) =>
  !!state.cursor ||
  !!state.selection ||
  state.scrollTop !== undefined ||
  state.scrollLeft !== undefined ||
  (state.collapsedFoldLines?.length ?? 0) > 0;

export function buildPersistedEditorViewState(
  buffer: EditorContent,
): PersistedEditorViewState | undefined {
  const viewState = useEditorStateStore.getState().actions.getCachedViewState(buffer.id);
  const collapsedFoldLines = useFoldStore.getState().actions.getCollapsedLines(buffer.path);

  const persistedState: PersistedEditorViewState = {
    cursor: viewState?.cursor,
    selection: viewState?.selection,
    scrollTop: viewState?.scrollTop,
    scrollLeft: viewState?.scrollLeft,
    collapsedFoldLines: collapsedFoldLines.length > 0 ? collapsedFoldLines : undefined,
  };

  return hasPersistedEditorViewState(persistedState) ? persistedState : undefined;
}

export function restorePersistedEditorViewState(
  buffer: EditorContent,
  persistedState: PersistedEditorViewState | undefined,
) {
  if (!persistedState) {
    return;
  }

  if (
    persistedState.cursor ||
    persistedState.selection ||
    persistedState.scrollTop !== undefined ||
    persistedState.scrollLeft !== undefined
  ) {
    const viewState: EditorViewState = {
      cursor: persistedState.cursor ?? { line: 0, column: 0, offset: 0 },
      selection: persistedState.selection,
      scrollTop: persistedState.scrollTop ?? 0,
      scrollLeft: persistedState.scrollLeft ?? 0,
    };
    useEditorStateStore.getState().actions.cacheViewStateForBuffer(buffer.id, viewState);
  }

  if (persistedState.collapsedFoldLines) {
    useFoldStore
      .getState()
      .actions.setCollapsedLines(buffer.path, persistedState.collapsedFoldLines);
  }
}
