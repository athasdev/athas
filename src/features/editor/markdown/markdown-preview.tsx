import "./styles.css";
import { exists } from "@tauri-apps/plugin-fs";
import { open } from "@tauri-apps/plugin-shell";
import { useCallback, useEffect, useRef, useState } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useEditorSettingsStore } from "@/features/editor/stores/settings-store";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import { useSettingsStore } from "@/features/settings/store";
import { logger } from "../utils/logger";
import { parseMarkdown } from "./parser";

export function MarkdownPreview() {
  const buffers = useBufferStore.use.buffers();
  const activeBufferId = useBufferStore.use.activeBufferId();
  const activeBuffer = buffers.find((b) => b.id === activeBufferId);
  const fontSize = useEditorSettingsStore.use.fontSize();
  const uiFontFamily = useSettingsStore((state) => state.settings.uiFontFamily);
  const { handleFileSelect } = useFileSystemStore();
  const rootFolderPath = useFileSystemStore.use.rootFolderPath?.() || "";
  const [html, setHtml] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  // Get the source buffer if this is a preview buffer
  const sourceBuffer = activeBuffer?.sourceFilePath
    ? buffers.find((b) => b.path === activeBuffer.sourceFilePath)
    : activeBuffer;

  useEffect(() => {
    if (!sourceBuffer) return;
    const parsedHtml = parseMarkdown(sourceBuffer.content);
    setHtml(parsedHtml);
  }, [sourceBuffer?.content, sourceBuffer]);

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

      if (!sourceBuffer) return;

      const targetPath = resolvePath(href, sourceBuffer.path);

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
    [sourceBuffer, handleFileSelect, resolvePath],
  );

  return (
    <div
      ref={containerRef}
      className="markdown-preview flex h-full justify-center overflow-auto bg-primary-bg p-6"
      style={{
        fontSize: `${fontSize}px`,
        fontFamily: `${uiFontFamily}, sans-serif`,
      }}
      onClick={handleLinkClick}
    >
      <div
        className="markdown-content w-full max-w-3xl"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
