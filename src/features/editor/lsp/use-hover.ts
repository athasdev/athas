import { useCallback, useEffect, useRef } from "react";
import type { Hover, MarkedString, MarkupContent } from "vscode-languageserver-types";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import { useEditorUIStore } from "../stores/ui-store";
import { logger } from "../utils/logger";

interface UseHoverProps {
  getHover?: (filePath: string, line: number, character: number) => Promise<Hover | null>;
  isLanguageSupported?: (filePath: string) => boolean;
  filePath: string;
  fontSize: number;
  charWidth: number;
}

export const useHover = ({
  getHover,
  isLanguageSupported,
  filePath,
  fontSize,
  charWidth,
}: UseHoverProps) => {
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverRequestIdRef = useRef(0);

  const actions = useEditorUIStore.use.actions();

  const handleHover = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!getHover || !isLanguageSupported?.(filePath || "")) {
        return;
      }

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
        const x = clientX - rect.left;
        const y = clientY - rect.top;

        const lineHeight = Math.ceil(fontSize * EDITOR_CONSTANTS.LINE_HEIGHT_MULTIPLIER);
        // Editor container is already to the right of gutter, so do not subtract gutter width again.
        const contentOffsetX = EDITOR_CONSTANTS.EDITOR_PADDING_LEFT;
        const paddingTop = EDITOR_CONSTANTS.EDITOR_PADDING_TOP;
        const scrollTop = textarea?.scrollTop ?? 0;
        const scrollLeft = textarea?.scrollLeft ?? 0;

        const line = Math.floor((y - paddingTop + scrollTop) / lineHeight);
        const character = Math.floor((x - contentOffsetX + scrollLeft) / charWidth);

        if (line >= 0 && character >= 0) {
          try {
            logger.debug("Editor", `Requesting hover at ${filePath}:${line}:${character}`);
            const hoverResult = await getHover(filePath || "", line, character);
            if (requestId !== hoverRequestIdRef.current) return;
            if (!useEditorUIStore.getState().isHovering) return;
            logger.debug("Editor", `Hover result:`, hoverResult);
            if (hoverResult?.contents) {
              let content = "";

              const formatHoverItem = (item: string | MarkedString | MarkupContent): string => {
                if (typeof item === "string") {
                  return item;
                }
                if ("language" in item && item.language && item.value) {
                  const singleLine = !item.value.includes("\n");
                  // Keep single-line signatures compact in tooltip.
                  if (singleLine && item.value.length <= 220) {
                    return `\`${item.value}\``;
                  }
                  return `\`\`\`${item.language}\n${item.value}\n\`\`\``;
                }
                if ("kind" in item && item.value) {
                  return item.value;
                }
                return "";
              };

              if (typeof hoverResult.contents === "string") {
                content = hoverResult.contents;
              } else if (Array.isArray(hoverResult.contents)) {
                content = hoverResult.contents.map(formatHoverItem).filter(Boolean).join("\n");
              } else {
                content = formatHoverItem(hoverResult.contents);
              }

              content = content
                .replace(/^\s*---+\s*$/gm, "")
                .replace(/\n{3,}/g, "\n\n")
                .trim();

              if (content.trim()) {
                const tooltipWidth = EDITOR_CONSTANTS.DROPDOWN_MAX_WIDTH;
                const tooltipHeight = EDITOR_CONSTANTS.HOVER_TOOLTIP_HEIGHT;
                const margin = EDITOR_CONSTANTS.HOVER_TOOLTIP_MARGIN;

                let tooltipX = clientX + 15;
                let tooltipY = clientY + 15;

                if (tooltipX + tooltipWidth > window.innerWidth - margin) {
                  tooltipX = clientX - tooltipWidth - 15;
                }

                if (tooltipY + tooltipHeight > window.innerHeight - margin) {
                  tooltipY = clientY - tooltipHeight - 15;
                }

                tooltipX = Math.max(
                  margin,
                  Math.min(tooltipX, window.innerWidth - tooltipWidth - margin),
                );
                tooltipY = Math.max(
                  margin,
                  Math.min(tooltipY, window.innerHeight - tooltipHeight - margin),
                );

                actions.setHoverInfo({
                  content: content.trim(),
                  position: { top: tooltipY, left: tooltipX },
                });
              }
            }
          } catch (error) {
            logger.error("Editor", "LSP hover error:", error);
          }
        }
      }, EDITOR_CONSTANTS.HOVER_TOOLTIP_DELAY);
    },
    [getHover, isLanguageSupported, filePath, fontSize, charWidth, actions.setHoverInfo],
  );

  const handleMouseLeave = useCallback(() => {
    actions.setIsHovering(false);
    hoverRequestIdRef.current += 1;
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
    setTimeout(() => {
      const tooltipHovered = document.querySelector(".hover-tooltip:hover") !== null;
      if (!useEditorUIStore.getState().isHovering && !tooltipHovered) {
        actions.setHoverInfo(null);
      }
    }, 150);
  }, [actions.setIsHovering, actions.setHoverInfo]);

  const handleMouseEnter = useCallback(() => {
    hoverRequestIdRef.current += 1;
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
