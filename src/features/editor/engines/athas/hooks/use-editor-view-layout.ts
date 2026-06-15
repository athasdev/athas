import { useMemo } from "react";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import { useInlineEditToolbarStore } from "@/features/editor/stores/inline-edit-toolbar.store";
import {
  buildEditorViewLayout,
  type EditorViewLayout,
  type EditorViewZone,
} from "@/features/editor/view-model/view-layout";
import {
  calculateInlineDiffHeight,
  getInlineDiffLinesToShow,
} from "../components/diff/inline-diff";
import type { FoldTransformResult } from "./use-fold-transform";
import type { InlineDiffState } from "./use-inline-diff";

const INLINE_EDIT_VIEW_ZONE_HEIGHT = 42;

interface UseEditorViewLayoutOptions {
  lines: string[];
  visualLineCount: number;
  lineHeight: number;
  wordWrap: boolean;
  contentWidth: number;
  measureText: (text: string) => number;
  largeContentMode: boolean;
  foldTransform: FoldTransformResult;
  inlineDiffState: InlineDiffState;
  cursorLine: number;
}

interface UseEditorViewLayoutResult {
  viewZones: EditorViewZone[];
  viewLayout: EditorViewLayout;
  editorBottomSafePadding: number;
  inlineDiffTop?: number;
  inlineEditZoneTop?: number;
}

export function useEditorViewLayout({
  lines,
  visualLineCount,
  lineHeight,
  wordWrap,
  contentWidth,
  measureText,
  largeContentMode,
  foldTransform,
  inlineDiffState,
  cursorLine,
}: UseEditorViewLayoutOptions): UseEditorViewLayoutResult {
  const isInlineEditToolbarVisible = useInlineEditToolbarStore.use.isVisible();

  const viewZones = useMemo(() => {
    const zones: EditorViewZone[] = [];

    if (inlineDiffState.isOpen && !largeContentMode) {
      const visualLine = foldTransform.hasActiveFolds
        ? (foldTransform.mapping.actualToVirtual.get(inlineDiffState.lineNumber) ??
          inlineDiffState.lineNumber)
        : inlineDiffState.lineNumber;

      if (visualLine >= 0 && visualLine < lines.length) {
        const linesToShow = getInlineDiffLinesToShow(
          inlineDiffState.diffLines,
          inlineDiffState.lineNumber,
          inlineDiffState.type,
        );

        zones.push({
          id: "inline-diff",
          afterLine: visualLine,
          height: calculateInlineDiffHeight(linesToShow.length, lineHeight),
        });
      }
    }

    if (isInlineEditToolbarVisible && !largeContentMode) {
      const visualLine = foldTransform.hasActiveFolds
        ? (foldTransform.mapping.actualToVirtual.get(cursorLine) ?? cursorLine)
        : cursorLine;

      if (visualLine >= 0 && visualLine < lines.length) {
        zones.push({
          id: "inline-edit",
          afterLine: visualLine,
          height: INLINE_EDIT_VIEW_ZONE_HEIGHT,
        });
      }
    }

    return zones;
  }, [
    cursorLine,
    foldTransform.hasActiveFolds,
    foldTransform.mapping,
    inlineDiffState.diffLines,
    inlineDiffState.isOpen,
    inlineDiffState.lineNumber,
    inlineDiffState.type,
    isInlineEditToolbarVisible,
    largeContentMode,
    lineHeight,
    lines.length,
  ]);

  const viewLayout = useMemo(
    () =>
      buildEditorViewLayout({
        lines,
        lineCount: visualLineCount,
        lineHeight,
        wordWrap,
        contentWidth,
        measureText,
        zones: viewZones,
        compact: largeContentMode || (!wordWrap && viewZones.length === 0),
      }),
    [
      contentWidth,
      largeContentMode,
      lineHeight,
      lines,
      measureText,
      viewZones,
      visualLineCount,
      wordWrap,
    ],
  );

  const editorBottomSafePadding = useMemo(
    () =>
      Math.max(
        EDITOR_CONSTANTS.COMPLETION_DROPDOWN_SAFE_AREA,
        lineHeight * EDITOR_CONSTANTS.CURSOR_BOTTOM_SAFE_AREA_LINES,
      ),
    [lineHeight],
  );

  const inlineDiffTop = useMemo(() => {
    if (!inlineDiffState.isOpen) return undefined;
    const zone = viewLayout.zones.find((entry) => entry.id === "inline-diff");
    if (zone) return zone.top;

    const visualLine = foldTransform.hasActiveFolds
      ? (foldTransform.mapping.actualToVirtual.get(inlineDiffState.lineNumber) ??
        inlineDiffState.lineNumber)
      : inlineDiffState.lineNumber;

    if (visualLine < 0 || visualLine >= lines.length) return undefined;

    const lineText = lines[visualLine] ?? "";
    const segment = viewLayout.getSegmentForModelPosition(visualLine, lineText.length);
    return segment.top + segment.height;
  }, [
    foldTransform.hasActiveFolds,
    foldTransform.mapping,
    inlineDiffState.isOpen,
    inlineDiffState.lineNumber,
    lines,
    viewLayout,
  ]);

  const inlineEditZoneTop = useMemo(() => {
    const zone = viewLayout.zones.find((entry) => entry.id === "inline-edit");
    return zone?.top;
  }, [viewLayout]);

  return {
    viewZones,
    viewLayout,
    editorBottomSafePadding,
    inlineDiffTop,
    inlineEditZoneTop,
  };
}
