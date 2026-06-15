import { type RefObject, useCallback, useEffect } from "react";
import type {
  EditorCoordinateResolver,
  EditorModelPositionResolver,
  EditorViewLayout,
} from "@/features/editor/view-model/view-layout";

interface FoldMapping {
  actualToVirtual: Map<number, number>;
  virtualToActual: Map<number, number>;
}

interface UseEditorSurfaceResolversOptions {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  contentContainerRef: RefObject<HTMLDivElement | null>;
  viewLayout: EditorViewLayout;
  hasActiveFolds: boolean;
  foldMapping: FoldMapping;
  visualLineCount: number;
  onCoordinateResolverChange?: (resolver: EditorCoordinateResolver | null) => void;
  onModelPositionResolverChange?: (resolver: EditorModelPositionResolver | null) => void;
}

export function useEditorSurfaceResolvers({
  inputRef,
  contentContainerRef,
  viewLayout,
  hasActiveFolds,
  foldMapping,
  visualLineCount,
  onCoordinateResolverChange,
  onModelPositionResolverChange,
}: UseEditorSurfaceResolversOptions) {
  const resolveEditorCoordinate = useCallback<EditorCoordinateResolver>(
    (clientX, clientY) => {
      const textarea = inputRef.current;
      const container = contentContainerRef.current;
      if (!textarea || !container) return null;

      const rect = container.getBoundingClientRect();
      const x = clientX - rect.left + textarea.scrollLeft;
      const y = clientY - rect.top + textarea.scrollTop;
      const position = viewLayout.editorPointToModelPosition(x, y);
      const actualLine = hasActiveFolds
        ? (foldMapping.virtualToActual.get(position.modelLine) ?? position.modelLine)
        : position.modelLine;

      return {
        ...position,
        line: actualLine,
        modelLine: actualLine,
        height: position.segment.height,
      };
    },
    [contentContainerRef, foldMapping, hasActiveFolds, inputRef, viewLayout],
  );

  const resolveModelPosition = useCallback<EditorModelPositionResolver>(
    (line, column) => {
      const virtualLine = hasActiveFolds ? (foldMapping.actualToVirtual.get(line) ?? line) : line;

      if (virtualLine < 0 || virtualLine >= visualLineCount) return null;

      const position = viewLayout.modelPositionToViewPosition(virtualLine, column);

      return {
        ...position,
        line,
        modelLine: line,
        height: position.segment.height,
      };
    },
    [foldMapping, hasActiveFolds, visualLineCount, viewLayout],
  );

  useEffect(() => {
    onCoordinateResolverChange?.(resolveEditorCoordinate);
    return () => onCoordinateResolverChange?.(null);
  }, [onCoordinateResolverChange, resolveEditorCoordinate]);

  useEffect(() => {
    onModelPositionResolverChange?.(resolveModelPosition);
    return () => onModelPositionResolverChange?.(null);
  }, [onModelPositionResolverChange, resolveModelPosition]);

  return {
    resolveEditorCoordinate,
    resolveModelPosition,
  };
}
