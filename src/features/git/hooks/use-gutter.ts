import { useCallback, useEffect, useMemo, useRef } from "react";
import { useEditorDecorationsStore } from "@/features/editor/stores/decorations-store";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import { getFileDiff, getFileDiffAgainstContent } from "../api/diff";
import type { GitDiff } from "../types/git";

interface GitGutterHookOptions {
  filePath: string;
  content: string;
  enabled?: boolean;
}

interface ProcessedGitChanges {
  addedLines: Set<number>;
  modifiedLines: Set<number>;
  deletedLines: Map<number, number>;
}

const LARGE_FILE_CONTENT_THRESHOLD = 250_000;
const GUTTER_SKIP_PATH_PREFIXES = [
  "archives/",
  "node_modules/",
  "vendor/",
  ".cargo/",
  "target/",
  ".next/",
  "dist/",
  "build/",
];

function toRelativePath(filePath: string, rootFolderPath: string): string {
  let relativePath = filePath;
  if (relativePath.startsWith(rootFolderPath)) {
    relativePath = relativePath.slice(rootFolderPath.length);
  }
  if (relativePath.startsWith("/")) {
    relativePath = relativePath.slice(1);
  }
  return relativePath.replace(/\\/g, "/");
}

function shouldSkipGitGutter(relativePath: string, contentLength: number): boolean {
  if (contentLength > LARGE_FILE_CONTENT_THRESHOLD) {
    return true;
  }

  return GUTTER_SKIP_PATH_PREFIXES.some((prefix) => relativePath.startsWith(prefix));
}

export function useGitGutter({ filePath, content, enabled = true }: GitGutterHookOptions) {
  const gitDecorationIdsRef = useRef<string[]>([]);
  const lastDiffRef = useRef<GitDiff | null>(null);
  const lastContentHashRef = useRef<string>("");
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  const latestRequestedContentRef = useRef<string>(content);

  const rootFolderPath = useFileSystemStore((state) => state.rootFolderPath);

  const contentHash = useMemo(() => {
    if (!content) return "";
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0;
    }
    return hash.toString(36);
  }, [content]);

  const processGitDiff = useCallback((diff: GitDiff): ProcessedGitChanges => {
    const addedLines = new Set<number>();
    const modifiedLines = new Set<number>();
    const deletedLines = new Map<number, number>();

    if (!diff.lines || diff.lines.length === 0) {
      return { addedLines, modifiedLines, deletedLines };
    }

    let i = 0;
    while (i < diff.lines.length) {
      const line = diff.lines[i];

      if (line.line_type === "removed") {
        let deletedCount = 0;
        let j = i;

        while (j < diff.lines.length && diff.lines[j].line_type === "removed") {
          deletedCount++;
          j++;
        }

        let addedCount = 0;
        let k = j;
        while (k < diff.lines.length && diff.lines[k].line_type === "added") {
          addedCount++;
          k++;
        }

        if (addedCount > 0) {
          const startLine = diff.lines[j]?.new_line_number;
          if (typeof startLine === "number") {
            const modCount = Math.min(deletedCount, addedCount);
            for (let m = 0; m < modCount; m++) {
              modifiedLines.add(startLine - 1 + m);
            }
            for (let m = modCount; m < addedCount; m++) {
              addedLines.add(startLine - 1 + m);
            }
            if (deletedCount > addedCount) {
              const deletedLine = startLine - 1 + addedCount;
              deletedLines.set(deletedLine, deletedCount - addedCount);
            }
          }
          i = k;
        } else {
          const nextLine = diff.lines[j];
          const deletedAtLine = nextLine?.new_line_number
            ? nextLine.new_line_number - 1
            : Math.max(0, (diff.lines[i]?.old_line_number || 1) - 1);
          deletedLines.set(deletedAtLine, deletedCount);
          i = j;
        }
      } else if (line.line_type === "added") {
        if (typeof line.new_line_number === "number") {
          addedLines.add(line.new_line_number - 1);
        }
        i++;
      } else {
        i++;
      }
    }

    return { addedLines, modifiedLines, deletedLines };
  }, []);

  const applyGitDecorations = useCallback((changes: ProcessedGitChanges) => {
    const { addedLines, modifiedLines, deletedLines } = changes;
    const decorationsStore = useEditorDecorationsStore.getState();

    if (gitDecorationIdsRef.current.length > 0) {
      decorationsStore.removeDecorations(gitDecorationIdsRef.current);
      gitDecorationIdsRef.current = [];
    }

    const newDecorations: any[] = [];

    const createDecoration = (lineNumber: number, className: string, content: string = " ") => ({
      type: "gutter" as const,
      className,
      content,
      range: {
        start: { line: lineNumber, column: 0, offset: 0 },
        end: { line: lineNumber, column: 0, offset: 0 },
      },
    });

    addedLines.forEach((ln) => {
      newDecorations.push(createDecoration(ln, "git-gutter-added"));
    });
    modifiedLines.forEach((ln) => {
      newDecorations.push(createDecoration(ln, "git-gutter-modified"));
    });
    deletedLines.forEach((count, ln) => {
      newDecorations.push(createDecoration(ln, "git-gutter-deleted", `−${count > 1 ? count : ""}`));
    });

    if (newDecorations.length > 0) {
      gitDecorationIdsRef.current = decorationsStore.addDecorations(newDecorations);
    }
  }, []);

  const clearGitDecorations = useCallback(() => {
    const decorationsStore = useEditorDecorationsStore.getState();
    if (gitDecorationIdsRef.current.length > 0) {
      decorationsStore.removeDecorations(gitDecorationIdsRef.current);
      gitDecorationIdsRef.current = [];
    }
  }, []);

  const updateGitGutter = useCallback(
    async (useContentDiff: boolean = false, specificContent?: string) => {
      const targetContent = specificContent ?? content;

      if (!enabled || !filePath || !rootFolderPath) {
        return;
      }
      if (filePath.startsWith("diff://")) {
        return;
      }

      try {
        const relativePath = toRelativePath(filePath, rootFolderPath);

        if (shouldSkipGitGutter(relativePath, targetContent?.length || 0)) {
          clearGitDecorations();
          return;
        }

        const diff = useContentDiff
          ? await getFileDiffAgainstContent(rootFolderPath, relativePath, targetContent, "head")
          : await getFileDiff(rootFolderPath, relativePath, false, targetContent);

        if (useContentDiff && targetContent !== latestRequestedContentRef.current) {
          return;
        }

        if (!diff || diff.is_binary || diff.is_image) {
          clearGitDecorations();
          return;
        }

        lastDiffRef.current = diff;

        const changes = processGitDiff(diff);
        applyGitDecorations(changes);
      } catch (error) {
        console.error(`[GitGutter] Error updating git gutter:`, error);
        clearGitDecorations();
      }
    },
    [
      enabled,
      filePath,
      rootFolderPath,
      processGitDiff,
      applyGitDecorations,
      content,
      clearGitDecorations,
    ],
  );

  const debouncedUpdate = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    const currentContent = content;
    latestRequestedContentRef.current = currentContent;

    debounceTimerRef.current = setTimeout(() => {
      updateGitGutter(true, currentContent);
    }, 500) as NodeJS.Timeout;
  }, [updateGitGutter, content]);

  useEffect(() => {
    if (filePath && rootFolderPath) {
      latestRequestedContentRef.current = content;
      lastContentHashRef.current = contentHash;
      updateGitGutter(false);
    }

    return () => {
      clearGitDecorations();
    };
  }, [filePath, rootFolderPath, content, contentHash, updateGitGutter, clearGitDecorations]);

  useEffect(() => {
    if (contentHash && contentHash !== lastContentHashRef.current) {
      lastContentHashRef.current = contentHash;
      debouncedUpdate();
    }
  }, [contentHash, debouncedUpdate]);

  useEffect(() => {
    if (!enabled || !filePath) return;

    const handleFileReload = (event: CustomEvent) => {
      const { path } = event.detail;
      if (path === filePath) {
        updateGitGutter(false);
      }
    };

    const handleGitStatusUpdate = (event?: CustomEvent) => {
      if (event?.detail?.filePath) {
        const eventFilePath = event.detail.filePath;
        if (eventFilePath !== filePath && !filePath.endsWith(eventFilePath)) {
          return;
        }
      }

      updateGitGutter(false);
    };

    window.addEventListener("file-reloaded", handleFileReload as EventListener);
    window.addEventListener("git-status-updated", handleGitStatusUpdate as EventListener);

    return () => {
      window.removeEventListener("file-reloaded", handleFileReload as EventListener);
      window.removeEventListener("git-status-updated", handleGitStatusUpdate as EventListener);

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [enabled, filePath, updateGitGutter]);

  return {
    updateGitGutter: useCallback(() => updateGitGutter(false), [updateGitGutter]),
    clearGitGutter: clearGitDecorations,
  };
}
