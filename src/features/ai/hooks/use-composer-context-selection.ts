import { useCallback, useMemo, useState } from "react";
import type { AIChatInputBarProps } from "@/features/ai/types/ai-chat.types";

type ComposerContextInputProps = Pick<
  AIChatInputBarProps,
  | "selectedBufferIds"
  | "selectedFilesPaths"
  | "onToggleBufferSelection"
  | "onToggleFileSelection"
  | "onSetSelectedBufferIds"
  | "onSetSelectedFilesPaths"
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

  const onToggleBufferSelection = useCallback((bufferId: string) => {
    setSelectedBufferIds((current) => toggleComposerContextSelection(current, bufferId));
  }, []);

  const onToggleFileSelection = useCallback((filePath: string) => {
    setSelectedFilesPaths((current) => toggleComposerContextSelection(current, filePath));
  }, []);

  const clear = useCallback(() => {
    setSelectedBufferIds(new Set());
    setSelectedFilesPaths(new Set());
  }, []);

  const replace = useCallback((bufferIds: Iterable<string>, filePaths: Iterable<string>) => {
    setSelectedBufferIds(new Set(bufferIds));
    setSelectedFilesPaths(new Set(filePaths));
  }, []);

  const inputProps = useMemo<ComposerContextInputProps>(
    () => ({
      selectedBufferIds,
      selectedFilesPaths,
      onToggleBufferSelection,
      onToggleFileSelection,
      onSetSelectedBufferIds: setSelectedBufferIds,
      onSetSelectedFilesPaths: setSelectedFilesPaths,
    }),
    [onToggleBufferSelection, onToggleFileSelection, selectedBufferIds, selectedFilesPaths],
  );

  return { clear, inputProps, replace };
}
