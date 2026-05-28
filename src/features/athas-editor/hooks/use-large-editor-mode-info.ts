import { useMemo, useRef } from "react";
import {
  applyIncrementalLargeEditorModeInfo,
  getLargeEditorModeInfo,
  type LargeEditorModeInfo,
} from "@/features/athas-editor/utils/large-file";

export function useLargeEditorModeInfo(content: string): LargeEditorModeInfo {
  const cacheRef = useRef<{
    content: string;
    info: LargeEditorModeInfo;
  } | null>(null);

  return useMemo(() => {
    const cached = cacheRef.current;
    if (cached?.content === content) {
      return cached.info;
    }

    const incrementalInfo = cached
      ? applyIncrementalLargeEditorModeInfo(cached.content, content, cached.info)
      : null;
    const info = incrementalInfo ?? getLargeEditorModeInfo(content);
    cacheRef.current = { content, info };
    return info;
  }, [content]);
}
