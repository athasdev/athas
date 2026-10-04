import type { FileSearchResult } from "@/features/file-search/lib/file-search-api";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { isBufferStoreOwnerLive } from "@/features/editor/services/buffer-store-owner";
import { workspaceRuntimeRegistry } from "@/features/workspace/runtime/workspace-runtime-registry";
import {
  captureSourceReplaceContext,
  replaceAllInSources,
  replaceNextInSource,
  SourceReplaceFailure,
} from "../services/source-replace-service";
import type { ContentSearchOptions } from "../types/global-search.types";

interface ReplacementView {
  workspaceId: string;
  searchKey: string;
  query: string;
  inputQuery: string;
  replacement: string;
  options: ContentSearchOptions;
  results?: FileSearchResult[];
  refreshSearch: () => Promise<void>;
}
export function useSourceReplacement(view: ReplacementView) {
  const viewRef = useRef(view);
  viewRef.current = view;
  const pending = useRef<AbortController | null>(null);
  const [replaceOperation, setReplaceOperation] = useState<"next" | "all" | null>(null);
  useEffect(() => {
    setReplaceOperation(null);
    return () => {
      pending.current?.abort();
      pending.current = null;
    };
  }, [view.workspaceId, view.searchKey, view.query, view.inputQuery]);
  const runReplacement = useCallback(
    async (
      operation: "next" | "all",
      pathsOrTarget: string[] | Parameters<typeof replaceNextInSource>[0],
    ) => {
      if (pending.current) return;
      const controller = new AbortController();
      pending.current = controller;
      setReplaceOperation(operation);
      const capturedView = viewRef.current;
      const isCurrent = () =>
        pending.current === controller &&
        !controller.signal.aborted &&
        viewRef.current.workspaceId === capturedView.workspaceId &&
        viewRef.current.searchKey === capturedView.searchKey &&
        viewRef.current.query === capturedView.query &&
        viewRef.current.inputQuery === capturedView.inputQuery;
      const mayNotify = () =>
        isCurrent() && workspaceRuntimeRegistry.getActiveWorkspaceId() === capturedView.workspaceId;
      let replaced = 0;
      try {
        const context = captureSourceReplaceContext(capturedView.workspaceId);
        if (capturedView.results)
          context.expectedMatches = new Map(
            capturedView.results.map((result) => [result.file_path, result.matches]),
          );
        context.signal = controller.signal;
        context.isCurrent = isCurrent;
        const result = Array.isArray(pathsOrTarget)
          ? await replaceAllInSources(
              pathsOrTarget,
              capturedView.query,
              capturedView.replacement,
              capturedView.options,
              context,
            )
          : await replaceNextInSource(
              pathsOrTarget,
              capturedView.query,
              capturedView.replacement,
              capturedView.options,
              context,
            );
        replaced = typeof result === "boolean" ? Number(result) : result;
        if (!replaced || !isCurrent() || !isBufferStoreOwnerLive(context)) return;
        try {
          await capturedView.refreshSearch();
        } catch (error) {
          if (mayNotify())
            toast.warning(
              `Replaced ${replaced} match(es), but refreshing results failed: ${String(error)}`,
            );
          return;
        }
        if (operation === "all" && mayNotify())
          toast.success(`Replaced ${replaced} ${replaced === 1 ? "match" : "matches"}`);
      } catch (error) {
        if (!isCurrent()) return;
        if (error instanceof SourceReplaceFailure && error.editedFiles > 0) {
          await capturedView.refreshSearch().catch(() => undefined);
        }
        if (mayNotify())
          toast.error(error instanceof Error ? error.message : "Failed to replace search matches");
      } finally {
        if (pending.current === controller) {
          pending.current = null;
          setReplaceOperation(null);
        }
      }
    },
    [],
  );
  const replaceNext = useCallback(
    (target: Parameters<typeof replaceNextInSource>[0]) => runReplacement("next", target),
    [runReplacement],
  );
  const replaceAll = useCallback(
    (paths: string[]) => runReplacement("all", paths),
    [runReplacement],
  );
  return { replaceOperation, replaceNext, replaceAll };
}
