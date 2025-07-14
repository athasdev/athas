import { useCallback, useRef } from "react";
import { useCodeEditorStore } from "../stores/code-editor-store";

interface UseHoverProps {
  getHover?: (filePath: string, line: number, character: number) => Promise<any>;
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

  const setHoverInfo = useCodeEditorStore(state => state.setHoverInfo);
  const setIsHovering = useCodeEditorStore(state => state.setIsHovering);
  const isHovering = useCodeEditorStore(state => state.isHovering);

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

              if (typeof hoverResult.contents === "string") {
                content = hoverResult.contents;
              } else if (Array.isArray(hoverResult.contents)) {
                content = hoverResult.contents
                  .map((item: any) => {
                    if (typeof item === "string") {
                      return item;
                    } else if (item.language && item.value) {
                      return `\`\`\`${item.language}\n${item.value}\n\`\`\``;
                    } else if (item.kind === "markdown" && item.value) {
                      return item.value;
                    } else if (item.value) {
                      return item.value;
                    }
                    return "";
                  })
                  .filter(Boolean)
                  .join("\n\n");
              } else if (hoverResult.contents.value) {
                content = hoverResult.contents.value;
              }

              if (content.trim()) {
                const tooltipWidth = 400;
                const tooltipHeight = 200;
                const margin = 10;

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

                setHoverInfo({
                  content: content.trim(),
                  position: { top: tooltipY, left: tooltipX },
                });
              }
            }
          } catch (error) {
            console.error("LSP hover error:", error);
          }
        }
      }, 300);
    },
    [getHover, isLanguageSupported, filePath, fontSize, lineNumbers, setHoverInfo],
  );

  const handleMouseLeave = useCallback(() => {
    setIsHovering(false);
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
    setTimeout(() => {
      if (!isHovering) {
        setHoverInfo(null);
      }
    }, 150);
  }, [isHovering, setIsHovering, setHoverInfo]);

  const handleMouseEnter = useCallback(() => {
    setIsHovering(true);
  }, [setIsHovering]);

  return {
    handleHover,
    handleMouseLeave,
    handleMouseEnter,
  };
};
