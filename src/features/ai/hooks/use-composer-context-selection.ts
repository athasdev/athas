import { useCallback, useMemo, useState } from "react";
import type { AIChatInputBarProps } from "@/features/ai/types/ai-chat.types";
import type { EditorSelectionContext } from "@/features/ai/types/ai-context.types";

type ComposerContextInputProps = Pick<
  AIChatInputBarProps,
  | "selectedBufferIds"
  | "selectedFilesPaths"
  | "onToggleBufferSelection"
  | "onToggleFileSelection"
  | "onSetSelectedBufferIds"
  | "onSetSelectedFilesPaths"
  | "selectedEditorContexts"
  | "onRemoveEditorContext"
>;

export function toggleComposerContextSelection(
  current: ReadonlySet<string>,
  value: string,
): Set<string> {
  const next = new Set(current);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

export function useComposerContextSelection() {
  const [selectedBufferIds, setSelectedBufferIds] = useState<Set<string>>(new Set());
  const [selectedFilesPaths, setSelectedFilesPaths] = useState<Set<string>>(new Set());
  const [selectedEditorContexts, setSelectedEditorContexts] = useState<EditorSelectionContext[]>(
    [],
  );

  const onToggleBufferSelection = useCallback((bufferId: string) => {
    setSelectedBufferIds((current) => toggleComposerContextSelection(current, bufferId));
  }, []);

  const onToggleFileSelection = useCallback((filePath: string) => {
    setSelectedFilesPaths((current) => toggleComposerContextSelection(current, filePath));
  }, []);

  const clear = useCallback(() => {
    setSelectedBufferIds(new Set());
    setSelectedFilesPaths(new Set());
    setSelectedEditorContexts([]);
  }, []);

  const replace = useCallback(
    (
      bufferIds: Iterable<string>,
      filePaths: Iterable<string>,
      editorContexts: EditorSelectionContext[] = [],
    ) => {
      setSelectedBufferIds(new Set(bufferIds));
      setSelectedFilesPaths(new Set(filePaths));
      setSelectedEditorContexts(editorContexts);
    },
    [],
  );

  const removeEditorContext = useCallback((contextId: string) => {
    setSelectedEditorContexts((current) => current.filter((context) => context.id !== contextId));
  }, []);

  const inputProps = useMemo<ComposerContextInputProps>(
    () => ({
      selectedBufferIds,
      selectedFilesPaths,
      selectedEditorContexts,
      onToggleBufferSelection,
      onToggleFileSelection,
      onSetSelectedBufferIds: setSelectedBufferIds,
      onSetSelectedFilesPaths: setSelectedFilesPaths,
      onRemoveEditorContext: removeEditorContext,
    }),
    [
      onToggleBufferSelection,
      onToggleFileSelection,
      removeEditorContext,
      selectedBufferIds,
      selectedEditorContexts,
      selectedFilesPaths,
    ],
  );

  return { clear, inputProps, replace };
}
