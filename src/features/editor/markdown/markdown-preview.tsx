import "./styles.css";
import { exists } from "@tauri-apps/plugin-fs";
import { open } from "@tauri-apps/plugin-shell";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { editorAPI } from "@/features/editor/extensions/api";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useEditorSettingsStore } from "@/features/editor/stores/settings.store";
import { getBufferById, getBufferByPath } from "@/features/editor/utils/buffer-index";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { hasTextContent } from "@/features/panes/types/pane-content.types";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { SearchPopover } from "@/ui/search";
import { logger } from "../utils/logger";
import {
  highlightMarkdownPreviewMatches,
  isEntireMarkdownPreviewSelected,
} from "./markdown-preview-search";
import { useHighlightedMarkdown } from "./use-highlighted-markdown";

export function MarkdownPreview({
  bufferId,
  isActiveSurface = true,
}: {
  bufferId?: string;
  isActiveSurface?: boolean;
}) {
  const { sourceBufferPath, sourceContent } = useBufferStore(
    useShallow((state) => {
      const activeBuffer = getBufferById(state.buffers, bufferId ?? state.activeBufferId);
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
  const contentRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const html = useHighlightedMarkdown(sourceContent, { frontMatter: "render" });
  const { html: renderedHtml, matchCount } = useMemo(
    () => highlightMarkdownPreviewMatches(html, isSearchOpen ? searchQuery : ""),
    [html, isSearchOpen, searchQuery],
  );

  useEffect(() => {
    if (isActiveSurface) containerRef.current?.focus({ preventScroll: true });
  }, [isActiveSurface]);

  useEffect(() => {
    if (!isActiveSurface) return;
    const ownerId = `markdown-preview:${bufferId ?? sourceBufferPath}`;
    editorAPI.setActiveFindAdapter({ ownerId, openFind: () => setIsSearchOpen(true) });
    return () => editorAPI.clearActiveFindAdapter(ownerId);
  }, [bufferId, isActiveSurface, sourceBufferPath]);

  useEffect(() => {
    if (!isActiveSurface) return;
    const handleCopy = (event: ClipboardEvent) => {
      const activeElement = document.activeElement;
      if (
        activeElement instanceof HTMLInputElement ||
        activeElement instanceof HTMLTextAreaElement ||
        (activeElement instanceof HTMLElement && activeElement.isContentEditable)
      ) {
        return;
      }

      const content = contentRef.current;
      const selection = window.getSelection();
      if (!content || !selection || !isEntireMarkdownPreviewSelected(content, selection)) return;
      event.preventDefault();
      event.clipboardData?.setData("text/plain", sourceContent);
    };

    document.addEventListener("copy", handleCopy);
    return () => document.removeEventListener("copy", handleCopy);
  }, [isActiveSurface, sourceContent]);

  useEffect(() => {
    if (isSearchOpen) searchInputRef.current?.focus();
  }, [isSearchOpen]);

  useEffect(() => {
    setCurrentMatchIndex((index) => (matchCount ? Math.min(index, matchCount - 1) : 0));
  }, [matchCount]);

  useEffect(() => {
    const matches = contentRef.current?.querySelectorAll<HTMLElement>(
      "[data-markdown-search-match]",
    );
    if (!matches?.length) return;
    matches.forEach((match, index) => {
      match.toggleAttribute("data-current", index === currentMatchIndex);
    });
    matches[currentMatchIndex]?.scrollIntoView({ block: "center", inline: "nearest" });
  }, [currentMatchIndex, renderedHtml]);

  const navigateSearch = (direction: number) => {
    if (matchCount === 0) return;
    setCurrentMatchIndex((index) => (index + direction + matchCount) % matchCount);
  };

  const closeSearch = () => {
    setIsSearchOpen(false);
    containerRef.current?.focus();
  };

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
    <div className="relative size-full min-h-0">
      {isSearchOpen ? (
        <div className="absolute top-2 right-2 z-30">
          <SearchPopover
            value={searchQuery}
            onChange={(value) => {
              setSearchQuery(value);
              setCurrentMatchIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                closeSearch();
              } else if (event.key === "Enter") {
                event.preventDefault();
                navigateSearch(event.shiftKey ? -1 : 1);
              }
            }}
            onClose={closeSearch}
            placeholder="Find in Markdown preview"
            inputRef={searchInputRef}
            matchLabel={
              searchQuery
                ? matchCount
                  ? `${currentMatchIndex + 1} of ${matchCount}`
                  : "No results"
                : null
            }
            onNext={() => navigateSearch(1)}
            onPrevious={() => navigateSearch(-1)}
            canNavigate={matchCount > 0}
          />
        </div>
      ) : null}
      <div
        ref={containerRef}
        data-markdown-preview
        tabIndex={0}
        className="markdown-preview flex h-full items-start justify-center overflow-auto bg-background px-6 pt-6 outline-none focus-visible:ring-2 focus-visible:ring-focus"
        style={{
          fontSize: `${fontSize}px`,
          fontFamily: `${uiFontFamily}, sans-serif`,
        }}
        onPointerUp={(event) => {
          if (event.button === 0 && window.getSelection()?.isCollapsed) {
            containerRef.current?.focus({ preventScroll: true });
          }
        }}
        onClick={handleLinkClick}
        onWheelCapture={handleWheelCapture}
      >
        <div
          ref={contentRef}
          className="markdown-content typeset typeset-preview w-full max-w-3xl pb-safe-16"
          dangerouslySetInnerHTML={{ __html: renderedHtml }}
        />
      </div>
    </div>
  );
}
