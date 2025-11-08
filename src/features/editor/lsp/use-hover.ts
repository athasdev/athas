import { useCallback, useRef } from "react";
import type { Hover, MarkedString, MarkupContent } from "vscode-languageserver-types";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import { useEditorUIStore } from "../stores/ui-store";
import { logger } from "../utils/logger";

interface UseHoverProps {
  getHover?: (filePath: string, line: number, character: number) => Promise<Hover | null>;
  isLanguageSupported?: (filePath: string) => boolean;
  filePath: string;
  fontSize: number;
  lineNumbers: boolean;
}

export const useHover = ({
  getHover,
  isLanguageSupported,
  filePath,
  fontSize,
  lineNumbers,
}: UseHoverProps) => {
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { actions, isHovering } = useEditorUIStore();

  const handleHover = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!getHover || !isLanguageSupported?.(filePath || "")) {
        return;
      }

      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }

      hoverTimeoutRef.current = setTimeout(async () => {
        const editor = e.currentTarget;
        if (!editor) return;
        const rect = editor.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const lineHeight = fontSize * 1.4;
        const charWidth = fontSize * 0.6;
        const paddingLeft = lineNumbers ? 8 : 16;
        const paddingTop = 16;

        const line = Math.floor((y - paddingTop + editor.scrollTop) / lineHeight);
        const character = Math.floor((x - paddingLeft + editor.scrollLeft) / charWidth);

        if (line >= 0 && character >= 0) {
          try {
            const hoverResult = await getHover(filePath || "", line, character);
            if (hoverResult?.contents) {
              let content = "";

              const formatHoverItem = (item: string | MarkedString | MarkupContent): string => {
                if (typeof item === "string") {
                  return item;
                }
                if ("language" in item && item.language && item.value) {
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
                content = hoverResult.contents.map(formatHoverItem).filter(Boolean).join("\n\n");
              } else {
                content = formatHoverItem(hoverResult.contents);
              }

              if (content.trim()) {
                const tooltipWidth = EDITOR_CONSTANTS.DROPDOWN_MAX_WIDTH;
                const tooltipHeight = EDITOR_CONSTANTS.HOVER_TOOLTIP_HEIGHT;
                const margin = EDITOR_CONSTANTS.HOVER_TOOLTIP_MARGIN;

                let tooltipX = e.clientX + 15;
                let tooltipY = e.clientY + 15;

                if (tooltipX + tooltipWidth > window.innerWidth - margin) {
                  tooltipX = e.clientX - tooltipWidth - 15;
                }

                if (tooltipY + tooltipHeight > window.innerHeight - margin) {
                  tooltipY = e.clientY - tooltipHeight - 15;
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
    [getHover, isLanguageSupported, filePath, fontSize, lineNumbers, actions.setHoverInfo],
  );

  const handleMouseLeave = useCallback(() => {
    actions.setIsHovering(false);
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
    setTimeout(() => {
      if (!isHovering) {
        actions.setHoverInfo(null);
      }
    }, 150);
  }, [isHovering, actions.setIsHovering, actions.setHoverInfo]);

  const handleMouseEnter = useCallback(() => {
    actions.setIsHovering(true);
  }, [actions.setIsHovering]);

  return {
    handleHover,
    handleMouseLeave,
    handleMouseEnter,
  };
};
