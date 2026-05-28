import { useMemo, useRef } from "react";
import { applyIncrementalLineEdit } from "@/features/editor/stores/view-store";
import { fileOpenBenchmark } from "@/features/athas-editor/utils/file-open-benchmark";
import { countLines, isTooLargeForEditorServices } from "@/features/athas-editor/utils/large-file";
import { splitLines } from "@/features/athas-editor/utils/lines";

interface UseEditorLineModelOptions {
  content: string;
  filePath?: string;
  largeContentModeOverride?: boolean;
  largeContentLineCount?: number;
  startMeasure: (metricName: string) => void;
  endMeasure: (metricName: string) => void;
}

interface ActualLinesCache {
  content: string;
  lineCount: number;
  largeContentMode: boolean;
  lines: string[];
}

export function useEditorLineModel({
  content,
  filePath,
  largeContentModeOverride,
  largeContentLineCount,
  startMeasure,
  endMeasure,
}: UseEditorLineModelOptions) {
  const actualLinesCacheRef = useRef<ActualLinesCache | null>(null);

  const actualLineCount = useMemo(() => {
    if (largeContentLineCount != null) return largeContentLineCount;

    const cached = actualLinesCacheRef.current;
    if (cached?.content === content) {
      return cached.lineCount;
    }

    const incrementallyUpdatedLines =
      cached && !cached.largeContentMode
        ? applyIncrementalLineEdit(cached.content, content, cached.lines)
        : null;

    if (incrementallyUpdatedLines) {
      actualLinesCacheRef.current = {
        content,
        lineCount: incrementallyUpdatedLines.length,
        largeContentMode: false,
        lines: incrementallyUpdatedLines,
      };
      return incrementallyUpdatedLines.length;
    }

    return countLines(content);
  }, [content, largeContentLineCount]);

  const largeContentMode =
    largeContentModeOverride ??
    isTooLargeForEditorServices({
      contentLength: content.length,
      lineCount: actualLineCount,
    });

  const actualLines = useMemo(() => {
    if (largeContentMode) {
      const cached = actualLinesCacheRef.current;
      if (
        cached &&
        cached.content === content &&
        cached.lineCount === actualLineCount &&
        cached.largeContentMode
      ) {
        return cached.lines;
      }

      const lines: string[] = [];
      actualLinesCacheRef.current = {
        content,
        lineCount: actualLineCount,
        largeContentMode,
        lines,
      };
      return lines;
    }

    const cached = actualLinesCacheRef.current;
    if (cached && cached.content === content && !cached.largeContentMode) {
      return cached.lines;
    }

    const incrementallyUpdatedLines =
      cached && !cached.largeContentMode
        ? applyIncrementalLineEdit(cached.content, content, cached.lines)
        : null;
    if (incrementallyUpdatedLines) {
      actualLinesCacheRef.current = {
        content,
        lineCount: incrementallyUpdatedLines.length,
        largeContentMode,
        lines: incrementallyUpdatedLines,
      };
      return incrementallyUpdatedLines;
    }

    if (filePath && fileOpenBenchmark.has(filePath)) {
      fileOpenBenchmark.mark(filePath, "split-start");
    }
    startMeasure(`splitLines (len: ${content.length})`);
    const lines = splitLines(content);
    endMeasure(`splitLines (len: ${content.length})`);
    if (filePath && fileOpenBenchmark.has(filePath)) {
      fileOpenBenchmark.mark(filePath, "split-done", `${lines.length} lines`);
    }
    actualLinesCacheRef.current = {
      content,
      lineCount: lines.length,
      largeContentMode,
      lines,
    };
    return lines;
  }, [actualLineCount, content, filePath, largeContentMode, startMeasure, endMeasure]);

  return {
    actualLineCount,
    largeContentMode,
    actualLines,
  };
}
