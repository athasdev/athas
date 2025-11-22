import { useCallback, useEffect, useMemo, useRef } from "react";
import { useEditorDecorationsStore } from "@/features/editor/stores/decorations-store";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import { getFileDiff, getFileDiffAgainstContent } from "../controllers/git";
import type { GitDiff } from "../types/git";

interface GitGutterHookOptions {
  filePath: string;
  content: string;
  enabled?: boolean;
}

interface ProcessedGitChanges {
  addedLines: Set<number>;
  modifiedLines: Set<number>;
  deletedLines: Map<number, number>; // line number -> count
}

export function useGitGutter({ filePath, content, enabled = true }: GitGutterHookOptions) {
  const gitDecorationIdsRef = useRef<string[]>([]);
  const lastDiffRef = useRef<GitDiff | null>(null);
  const lastContentHashRef = useRef<string>("");
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Track the latest content for which we've scheduled or started a diff
  const latestRequestedContentRef = useRef<string>(content);

  const rootFolderPath = useFileSystemStore((state) => state.rootFolderPath);

  // Memoized content hash for efficient change detection
  const contentHash = useMemo(() => {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(content);
    return content ? btoa(String.fromCharCode(...bytes)).slice(0, 32) : "";
  }, [content]);

  // Process git diff lines into line change information
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
        // Start of a deletion group
        let deletedCount = 0;
        let j = i;

        // Count consecutive deletions
        while (j < diff.lines.length && diff.lines[j].line_type === "removed") {
          deletedCount++;
          j++;
        }

        // Check if followed by additions (modification)
        let addedCount = 0;
        let k = j;
        while (k < diff.lines.length && diff.lines[k].line_type === "added") {
          addedCount++;
          k++;
        }

        if (addedCount > 0) {
          // Modification: deletions followed by additions
          const startLine = diff.lines[j]?.new_line_number;
          if (typeof startLine === "number") {
            const modCount = Math.min(deletedCount, addedCount);
            // Mark modified lines
            for (let m = 0; m < modCount; m++) {
              modifiedLines.add(startLine - 1 + m);
            }
            // Extra additions are new lines
            for (let m = modCount; m < addedCount; m++) {
              addedLines.add(startLine - 1 + m);
            }
            // Extra deletions show as deleted markers
            if (deletedCount > addedCount) {
              const deletedLine = startLine - 1 + addedCount;
              deletedLines.set(deletedLine, deletedCount - addedCount);
            }
          }
          i = k;
        } else {
          // Pure deletion
          const nextLine = diff.lines[j];
          const deletedAtLine = nextLine?.new_line_number
            ? nextLine.new_line_number - 1
            : Math.max(0, (diff.lines[i]?.old_line_number || 1) - 1);
          deletedLines.set(deletedAtLine, deletedCount);
          i = j;
        }
      } else if (line.line_type === "added") {
        // Pure addition
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

  // Apply git gutter decorations
  const applyGitDecorations = useCallback((changes: ProcessedGitChanges) => {
    const { addedLines, modifiedLines, deletedLines } = changes;
    const decorationsStore = useEditorDecorationsStore.getState();

    // Clear existing decorations
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

    // Prepare decorations
    addedLines.forEach((ln) => {
      newDecorations.push(createDecoration(ln, "git-gutter-added"));
    });
    modifiedLines.forEach((ln) => {
      newDecorations.push(createDecoration(ln, "git-gutter-modified"));
    });
    deletedLines.forEach((count, ln) => {
      newDecorations.push(createDecoration(ln, "git-gutter-deleted", `−${count > 1 ? count : ""}`));
    });

    // Batch add
    if (newDecorations.length > 0) {
      gitDecorationIdsRef.current = decorationsStore.addDecorations(newDecorations);
    }
  }, []);

  // Update git gutter decorations
  // This needs to be robust against stale closures
  const updateGitGutter = useCallback(
    async (useContentDiff: boolean = false, specificContent?: string) => {
      const targetContent = specificContent ?? content;

      console.log(`[GitGutter] updateGitGutter called for ${filePath}`, {
        enabled,
        filePath,
        rootFolderPath,
        contentLength: targetContent?.length || 0,
        useContentDiff,
      });

      if (!enabled || !filePath || !rootFolderPath) {
        console.log(`[GitGutter] Skipping update - missing requirements`);
        return;
      }
      if (filePath.startsWith("diff://")) {
        console.log(`[GitGutter] Skipping diff:// file`);
        return;
      }

      try {
        // Convert to relative path
        let relativePath = filePath;
        if (relativePath.startsWith(rootFolderPath)) {
          relativePath = relativePath.slice(rootFolderPath.length);
          if (relativePath.startsWith("/")) relativePath = relativePath.slice(1);
        }

        console.log(`[GitGutter] Getting diff for ${relativePath}`);

        // Use content-based diff for live typing, regular diff for file system events
        const diff = useContentDiff
          ? await getFileDiffAgainstContent(rootFolderPath, relativePath, targetContent, "head")
          : await getFileDiff(rootFolderPath, relativePath, false, targetContent);

        // Race condition check:
        // If we are using content diff, ensure the content we used is still the latest one
        if (useContentDiff && targetContent !== latestRequestedContentRef.current) {
          console.log(`[GitGutter] Skipping result - stale content`);
          return;
        }

        console.log(`[GitGutter] Got diff result:`, {
          hasDiff: !!diff,
          lineCount: diff?.lines?.length || 0,
          isBinary: diff?.is_binary,
          isImage: diff?.is_image,
        });

        if (!diff || diff.is_binary || diff.is_image) {
          // Clear decorations for binary/image files
          console.log(`[GitGutter] Clearing decorations - no diff or binary/image file`);
          const decorationsStore = useEditorDecorationsStore.getState();
          if (gitDecorationIdsRef.current.length > 0) {
            decorationsStore.removeDecorations(gitDecorationIdsRef.current);
            gitDecorationIdsRef.current = [];
          }
          return;
        }

        // Cache the diff for comparison
        lastDiffRef.current = diff;

        const changes = processGitDiff(diff);
        console.log(`[GitGutter] Processed changes:`, {
          added: changes.addedLines.size,
          modified: changes.modifiedLines.size,
          deleted: changes.deletedLines.size,
        });

        applyGitDecorations(changes);
      } catch (error) {
        console.error(`[GitGutter] Error updating git gutter:`, error);
        // Clear decorations on error
        const decorationsStore = useEditorDecorationsStore.getState();
        if (gitDecorationIdsRef.current.length > 0) {
          decorationsStore.removeDecorations(gitDecorationIdsRef.current);
          gitDecorationIdsRef.current = [];
        }
      }
    },
    [enabled, filePath, rootFolderPath, processGitDiff, applyGitDecorations, content],
  );

  // Debounced update function for content changes
  const debouncedUpdate = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Capture the current content at the time of scheduling
    const currentContent = content;
    latestRequestedContentRef.current = currentContent;

    debounceTimerRef.current = setTimeout(() => {
      updateGitGutter(true, currentContent); // Use content-based diff for live typing
    }, 500) as NodeJS.Timeout; // 500ms debounce for content changes
  }, [updateGitGutter, content]);

  // Initial update when file path changes
  useEffect(() => {
    if (filePath && rootFolderPath) {
      latestRequestedContentRef.current = content;
      updateGitGutter(false); // Use regular diff for initial load
    }

    return () => {
      // Clear decorations when component unmounts or file changes
      const decorationsStore = useEditorDecorationsStore.getState();
      if (gitDecorationIdsRef.current.length > 0) {
        decorationsStore.removeDecorations(gitDecorationIdsRef.current);
        gitDecorationIdsRef.current = [];
      }
    };
  }, [filePath, rootFolderPath]);

  // Update on content changes (debounced)
  useEffect(() => {
    if (contentHash && contentHash !== lastContentHashRef.current) {
      lastContentHashRef.current = contentHash;
      debouncedUpdate();
    }
  }, [contentHash, debouncedUpdate]);

  // Listen for file system changes to update git status
  useEffect(() => {
    if (!enabled || !filePath) return;

    const handleFileReload = (event: CustomEvent) => {
      const { path } = event.detail;
      if (path === filePath) {
        // File was reloaded from disk, update git gutter immediately
        updateGitGutter(false); // Use regular diff for file system changes
      }
    };

    const handleGitStatusUpdate = (event?: CustomEvent) => {
      console.log(`[GitGutter] handleGitStatusUpdate called`, {
        filePath,
        eventFilePath: event?.detail?.filePath,
      });

      // Git status changed, update git gutter immediately
      // Check if the event is for this specific file (if specified)
      if (event?.detail?.filePath) {
        const eventFilePath = event.detail.filePath;
        // Match both absolute and relative paths
        if (eventFilePath !== filePath && !filePath.endsWith(eventFilePath)) {
          console.log(`[GitGutter] Ignoring event - path mismatch`);
          return; // Not for this file, ignore
        }
      }

      console.log(`[GitGutter] Proceeding with git gutter update`);
      // Update immediately for git status changes (no debouncing needed)
      updateGitGutter(false); // Use regular diff for git status changes
    };

    // Listen for file reloads and git status updates
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

  // Return current git changes for external use if needed
  return {
    updateGitGutter: useCallback(() => updateGitGutter(false), [updateGitGutter]),
    clearGitGutter: useCallback(() => {
      const decorationsStore = useEditorDecorationsStore.getState();
      if (gitDecorationIdsRef.current.length > 0) {
        decorationsStore.removeDecorations(gitDecorationIdsRef.current);
        gitDecorationIdsRef.current = [];
      }
    }, []),
  };
}
