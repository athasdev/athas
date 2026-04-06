import { useEffect, useMemo } from "react";
import { detectLanguageFromPath } from "@/features/editor/utils/language-detection";
import type { EditorContent } from "@/features/panes/types/pane-content";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import type { TokenEntry } from "@/features/panes/types/pane-content";
import { createDiffTokensForEditorContent, getDiffEditorPath } from "../utils/diff-editor-content";

interface UseDiffEditorBufferOptions {
  cacheKey: string;
  content: string;
  sourcePath?: string;
  name: string;
  pathOverride?: string;
  languageOverride?: string;
  tokens?: TokenEntry[];
}

export function useDiffEditorBuffer({
  cacheKey,
  content,
  sourcePath,
  name,
  pathOverride,
  languageOverride,
  tokens,
}: UseDiffEditorBufferOptions): string {
  const bufferId = useMemo(
    () => `diff_editor_${cacheKey.replace(/[^a-zA-Z0-9_]/g, "_")}`,
    [cacheKey],
  );
  const bufferPath = useMemo(
    () => pathOverride ?? getDiffEditorPath(sourcePath, cacheKey),
    [cacheKey, pathOverride, sourcePath],
  );

  useEffect(() => {
    const nextBuffer: EditorContent = {
      id: bufferId,
      type: "editor",
      path: bufferPath,
      name,
      content,
      savedContent: content,
      isDirty: false,
      isVirtual: true,
      isPreview: false,
      isPinned: false,
      isActive: false,
      language: detectLanguageFromPath(bufferPath),
      languageOverride,
      tokens:
        tokens ?? (languageOverride === "diff" ? createDiffTokensForEditorContent(content) : []),
    };

    useBufferStore.setState((state) => {
      const existingIndex = state.buffers.findIndex((buffer) => buffer.id === bufferId);
      if (existingIndex === -1) {
        return {
          ...state,
          buffers: [...state.buffers, nextBuffer],
        };
      }

      const nextBuffers = [...state.buffers];
      nextBuffers[existingIndex] = {
        ...nextBuffers[existingIndex],
        ...nextBuffer,
      };

      return {
        ...state,
        buffers: nextBuffers,
      };
    });

    return () => {
      useBufferStore.setState((state) => ({
        ...state,
        buffers: state.buffers.filter((buffer) => buffer.id !== bufferId),
      }));
    };
  }, [bufferId, bufferPath, content, languageOverride, name, sourcePath, tokens]);

  return bufferId;
}
