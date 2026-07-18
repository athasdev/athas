import "./styles.css";
import { exists } from "@tauri-apps/plugin-fs";
import { open } from "@tauri-apps/plugin-shell";
import { useCallback, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useEditorSettingsStore } from "@/features/editor/stores/settings.store";
import { getBufferById, getBufferByPath } from "@/features/editor/utils/buffer-index";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { hasTextContent } from "@/features/panes/types/pane-content.types";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { logger } from "../utils/logger";
import { useHighlightedMarkdown } from "./use-highlighted-markdown";

export function MarkdownPreview() {
  const { sourceBufferPath, sourceContent } = useBufferStore(
    useShallow((state) => {
      const activeBuffer = getBufferById(state.buffers, state.activeBufferId);
      const sourceBuffer =
        activeBuffer?.type === "markdownPreview"
          ? (getBufferByPath(state.buffers, activeBuffer.sourceFilePath) ?? activeBuffer)
          : activeBuffer;

      return {
        sourceBufferPath: sourceBuffer?.path,
        sourceContent: sourceBuffer && hasTextContent(sourceBuffer) ? sourceBuffer.content : "",
      };
    }),
  );
  const fontSize = useEditorSettingsStore.use.fontSize();
  const uiFontFamily = useSettingsStore((state) => state.settings.uiFontFamily);
  const handleFileSelect = useFileSystemStore((state) => state.handleFileSelect);
  const rootFolderPath = useFileSystemStore((state) => state.rootFolderPath) || "";
  const containerRef = useRef<HTMLDivElement>(null);
  const html = useHighlightedMarkdown(sourceContent, { frontMatter: "render" });

  const resolvePath = useCallback(
    (href: string, currentFilePath: string): string => {
      const hrefWithoutAnchor = href.split("#")[0];

      if (!hrefWithoutAnchor) {
        return currentFilePath;
      }

      if (hrefWithoutAnchor.startsWith("/")) {
        if (rootFolderPath) {
          return `${rootFolderPath}${hrefWithoutAnchor}`;
        }
        return hrefWithoutAnchor;
      }

      const currentDir = currentFilePath.substring(0, currentFilePath.lastIndexOf("/"));
      const combined = `${currentDir}/${hrefWithoutAnchor}`;

      const parts = combined.split("/");
      const resolved: string[] = [];

      for (const part of parts) {
        if (part === "..") {
          resolved.pop();
        } else if (part !== "." && part !== "") {
          resolved.push(part);
        }
      }

      return `/${resolved.join("/")}`;
    },
    [rootFolderPath],
  );

  const handleLinkClick = useCallback(
    async (e: React.MouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement;
      const link = target.closest("a");

      if (!link) return;

      const href = link.getAttribute("href");
      if (!href) return;

      e.preventDefault();
      e.stopPropagation();

      if (href.startsWith("#")) {
        const elementId = href.substring(1);
        const targetElement = containerRef.current?.querySelector(`#${CSS.escape(elementId)}`);
        if (targetElement) {
          targetElement.scrollIntoView({ behavior: "smooth" });
        }
        return;
      }

      const isExternalLink =
        href.startsWith("http://") ||
        href.startsWith("https://") ||
        href.startsWith("mailto:") ||
        href.startsWith("tel:") ||
        href.startsWith("//");

      if (isExternalLink) {
        try {
          await open(href);
        } catch (error) {
          logger.error("MarkdownPreview", "Failed to open external link:", error);
        }
        return;
      }

      if (!sourceBufferPath) return;

      const targetPath = resolvePath(href, sourceBufferPath);

      try {
        const fileExists = await exists(targetPath);

        if (fileExists) {
          await handleFileSelect(targetPath, false);
        } else {
          const withMd = targetPath.endsWith(".md") ? targetPath : `${targetPath}.md`;
          const mdExists = await exists(withMd);

          if (mdExists) {
            await handleFileSelect(withMd, false);
          } else {
            logger.warn("MarkdownPreview", `File not found: ${targetPath}`);
          }
        }
      } catch (error) {
        logger.error("MarkdownPreview", "Failed to handle link:", error);
      }
    },
    [sourceBufferPath, handleFileSelect, resolvePath],
  );

  const handleWheelCapture = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    const container = containerRef.current;
    if (!container) return;

    const canScroll = container.scrollHeight > container.clientHeight;
    if (!canScroll || event.deltaY === 0) return;

    container.scrollTop += event.deltaY;
    event.preventDefault();
  }, []);

  return (
    <div
      ref={containerRef}
      className="markdown-preview flex h-full justify-center overflow-auto bg-primary-bg px-6 pt-6 pb-[calc(4rem+env(safe-area-inset-bottom))]"
      style={{
        fontSize: `${fontSize}px`,
        fontFamily: `${uiFontFamily}, sans-serif`,
      }}
      onClick={handleLinkClick}
      onWheelCapture={handleWheelCapture}
    >
      <div
        className="markdown-content w-full max-w-3xl"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
