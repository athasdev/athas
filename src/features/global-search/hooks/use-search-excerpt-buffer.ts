import { useEffect, useMemo } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { detectLanguageFromPath } from "@/features/editor/utils/language-detection";
import type { EditorContent } from "@/features/panes/types/pane-content.types";
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
  const name = useMemo(() => getBaseName(filePath, filePath), [filePath]);
  const language = useMemo(() => detectLanguageFromPath(filePath), [filePath]);

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
      language,
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
  }, [bufferId, content, filePath, language, name]);

  useEffect(() => {
    return () => {
      useBufferStore.setState((state) => ({
        ...state,
        buffers: state.buffers.filter((buffer) => buffer.id !== bufferId),
      }));
    };
  }, [bufferId]);

  return bufferId;
}
