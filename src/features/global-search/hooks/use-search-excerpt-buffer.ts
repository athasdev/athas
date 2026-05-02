import { useEffect, useMemo } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { detectLanguageFromPath } from "@/features/editor/utils/language-detection";
import type { EditorContent } from "@/features/panes/types/pane-content";
import { getBaseName } from "@/utils/path-helpers";

interface UseSearchExcerptBufferOptions {
  id: string;
  filePath: string;
  content: string;
}

export function useSearchExcerptBuffer({
  id,
  filePath,
  content,
}: UseSearchExcerptBufferOptions): string {
  const bufferId = useMemo(() => `search_excerpt_${id.replace(/[^a-zA-Z0-9_]/g, "_")}`, [id]);
  const name = getBaseName(filePath, filePath);

  useEffect(() => {
    const nextBuffer: EditorContent = {
      id: bufferId,
      type: "editor",
      path: filePath,
      name,
      content,
      savedContent: content,
      isDirty: false,
      isVirtual: true,
      isPreview: false,
      isPinned: false,
      isActive: false,
      language: detectLanguageFromPath(filePath),
      tokens: [],
    };

    useBufferStore.setState((state) => {
      const existingIndex = state.buffers.findIndex((buffer) => buffer.id === bufferId);
      if (existingIndex === -1) {
        return {
          ...state,
          buffers: [...state.buffers, nextBuffer],
        };
      }

      const existing = state.buffers[existingIndex];
      if (
        existing?.type === "editor" &&
        existing.path === filePath &&
        existing.name === name &&
        existing.content === content
      ) {
        return state;
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
  }, [bufferId, content, filePath, name]);

  return bufferId;
}
