import { useCallback, useEffect, useRef } from "react";
import type { Hover } from "vscode-languageserver-types";
import { useDiagnosticsStore } from "@/features/diagnostics/stores/diagnostics.store";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import {
  formatDiagnosticMessage,
  getDiagnosticAtPosition,
} from "@/features/editor/decorations/diagnostic-decorations";
import { useEditorUIStore } from "../stores/ui.store";
import { logger } from "../utils/logger";
import type { EditorCoordinateResolver } from "../view-model/view-layout";
import { formatHoverContents } from "./hover-content";

interface UseHoverProps {
  getHover?: (filePath: string, line: number, character: number) => Promise<Hover | null>;
  isLanguageSupported?: (filePath: string) => boolean;
  filePath: string;
  lineHeight: number;
  charWidth: number;
  resolveEditorPosition?: EditorCoordinateResolver;
}

function getLineTextAtLine(content: string, targetLine: number): string {
  if (targetLine <= 0) {
    const end = content.indexOf("\n");
    return end === -1 ? content : content.slice(0, end);
  }

  let currentLine = 0;
  let lineStart = 0;

  while (currentLine < targetLine) {
    const nextNewline = content.indexOf("\n", lineStart);
    if (nextNewline === -1) return "";
    lineStart = nextNewline + 1;
    currentLine++;
  }

  const lineEnd = content.indexOf("\n", lineStart);
  return lineEnd === -1 ? content.slice(lineStart) : content.slice(lineStart, lineEnd);
}

export const useHover = ({
  getHover,
  isLanguageSupported,
  filePath,
  lineHeight,
  charWidth,
  resolveEditorPosition,
}: UseHoverProps) => {
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverRequestIdRef = useRef(0);

  const actions = useEditorUIStore.use.actions();

  const handleHover = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!getHover || !isLanguageSupported?.(filePath || "")) {
        return;
      }

      actions.setIsHovering(true);

      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }

      const requestId = ++hoverRequestIdRef.current;

      // Snapshot event values immediately (React synthetic events are not safe to read asynchronously).
      const editor = e.currentTarget;
      const clientX = e.clientX;
      const clientY = e.clientY;

      hoverTimeoutRef.current = setTimeout(async () => {
        if (requestId !== hoverRequestIdRef.current) return;
        if (!useEditorUIStore.getState().isHovering) return;
        if (!editor) return;
        const textarea = editor.querySelector("textarea");
        const rect = editor.getBoundingClientRect();
        const bounds = {
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          left: rect.left,
        };
        const x = clientX - rect.left;
        const y = clientY - rect.top;

        // Editor container is already to the right of gutter, so do not subtract gutter width again.
        const contentOffsetX = EDITOR_CONSTANTS.EDITOR_PADDING_LEFT;
        const paddingTop = EDITOR_CONSTANTS.EDITOR_PADDING_TOP;
        const scrollTop = textarea?.scrollTop ?? 0;
        const scrollLeft = textarea?.scrollLeft ?? 0;
        const textContent = textarea?.value ?? "";

        const resolvedPosition = resolveEditorPosition?.(clientX, clientY);
        const line =
          resolvedPosition?.line ?? Math.floor((y - paddingTop + scrollTop) / lineHeight);
        const clampedLine = Math.max(0, line);
        const lineText = getLineTextAtLine(textContent, clampedLine);
        const lineLength = lineText.length;

        const character =
          resolvedPosition?.column ?? Math.floor((x - contentOffsetX + scrollLeft) / charWidth);
        const clampedCharacter = Math.max(0, Math.min(character, lineLength));

        if (clampedLine >= 0 && clampedCharacter >= 0) {
          const diagnostics = useDiagnosticsStore.getState().diagnosticsByFile.get(filePath) ?? [];
          const diagnostic =
            diagnostics.length > 0
              ? getDiagnosticAtPosition(
                  diagnostics,
                  textContent.split("\n"),
                  clampedLine,
                  clampedCharacter,
                )
              : null;
          if (diagnostic) {
            const tooltipWidth = EDITOR_CONSTANTS.DROPDOWN_MAX_WIDTH;
            const margin = EDITOR_CONSTANTS.HOVER_TOOLTIP_MARGIN;
            const gap = 6;
            const lineTop =
              rect.top +
              (resolvedPosition?.top ?? paddingTop + clampedLine * lineHeight) -
              scrollTop;
            const spaceAbove = lineTop - margin;
            const spaceBelow = window.innerHeight - (lineTop + lineHeight) - margin;
            const opensUpward =
              spaceAbove >= Math.min(EDITOR_CONSTANTS.HOVER_TOOLTIP_HEIGHT, spaceBelow);
            const tooltipY = opensUpward ? lineTop - gap : lineTop + lineHeight + gap;
            const tooltipX = Math.max(
              margin,
              Math.min(clientX, window.innerWidth - tooltipWidth - margin),
            );

            actions.setHoverInfo({
              content: formatDiagnosticMessage(diagnostic),
              position: { top: Math.max(margin, tooltipY), left: tooltipX },
              bounds,
              opensUpward,
            });
            return;
          }

          try {
            logger.debug(
              "Editor",
              `Requesting hover at ${filePath}:${clampedLine}:${clampedCharacter}`,
            );
            const hoverResult = await getHover(filePath || "", clampedLine, clampedCharacter);
            if (requestId !== hoverRequestIdRef.current) return;
            if (!useEditorUIStore.getState().isHovering) return;
            logger.debug("Editor", `Hover result:`, hoverResult);
            if (hoverResult?.contents) {
              const content = formatHoverContents(hoverResult.contents);

              if (content.trim()) {
                const tooltipWidth = EDITOR_CONSTANTS.DROPDOWN_MAX_WIDTH;
                const margin = EDITOR_CONSTANTS.HOVER_TOOLTIP_MARGIN;
                const gap = 6;
                const maxTooltipHeight = EDITOR_CONSTANTS.HOVER_TOOLTIP_HEIGHT;
                let tooltipX = clientX;
                const lineTop =
                  rect.top +
                  (resolvedPosition?.top ?? paddingTop + clampedLine * lineHeight) -
                  scrollTop;
                const spaceAbove = lineTop - margin;
                const spaceBelow = window.innerHeight - (lineTop + lineHeight) - margin;
                let opensUpward = spaceAbove >= Math.min(maxTooltipHeight, spaceBelow);

                let tooltipY: number;
                if (opensUpward) {
                  tooltipY = lineTop - gap;
                } else {
                  tooltipY = lineTop + lineHeight + gap;
                }

                // Clamp horizontally
                tooltipX = Math.max(
                  margin,
                  Math.min(tooltipX, window.innerWidth - tooltipWidth - margin),
                );
                tooltipY = Math.max(margin, tooltipY);

                actions.setHoverInfo({
                  content: content.trim(),
                  position: { top: tooltipY, left: tooltipX },
                  bounds,
                  opensUpward,
                });
              }
            }
          } catch (error) {
            logger.error("Editor", "LSP hover error:", error);
          }
        }
      }, EDITOR_CONSTANTS.HOVER_TOOLTIP_DELAY);
    },
    [
      getHover,
      isLanguageSupported,
      filePath,
      lineHeight,
      charWidth,
      resolveEditorPosition,
      actions.setHoverInfo,
      actions.setIsHovering,
    ],
  );

  const handleMouseLeave = useCallback(() => {
    actions.setIsHovering(false);
    hoverRequestIdRef.current += 1;
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
    setTimeout(() => {
      const tooltipHovered = document.querySelector(".editor-overlay-card:hover") !== null;
      if (!useEditorUIStore.getState().isHovering && !tooltipHovered) {
        actions.setHoverInfo(null);
      }
    }, 150);
  }, [actions.setIsHovering, actions.setHoverInfo]);

  const handleMouseEnter = useCallback(() => {
    actions.setIsHovering(true);
  }, [actions.setIsHovering]);

  // Clear hover when switching files/unmounting to avoid sticky tooltip across tabs.
  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
      hoverRequestIdRef.current += 1;
      actions.setHoverInfo(null);
      actions.setIsHovering(false);
    };
  }, [filePath, actions]);

  return {
    handleHover,
    handleMouseLeave,
    handleMouseEnter,
  };
};
