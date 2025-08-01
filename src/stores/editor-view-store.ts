import isEqual from "fast-deep-equal";
import { createWithEqualityFn } from "zustand/traditional";
import { createSelectors } from "@/utils/zustand-selectors";
import { tokenService } from "../lib/syntax-highlighting/token-service";
import type { LineToken } from "../types/editor-types";
import { useBufferStore } from "./buffer-store";

interface EditorViewState {
  // Computed views of the active buffer
  lines: string[];
  lineTokens: Map<number, LineToken[]>;

  // Actions
  actions: {
    getLines: () => string[];
    getLineTokens: () => Map<number, LineToken[]>;
    getContent: () => string;
  };
}

// Token conversion is now handled by the centralized token service

export const useEditorViewStore = createSelectors(
  createWithEqualityFn<EditorViewState>()(
    (_set, _get) => ({
      // These will be computed from the active buffer
      lines: [""],
      lineTokens: new Map(),

      actions: {
        getLines: () => {
          const activeBuffer = useBufferStore.getState().actions.getActiveBuffer();
          if (!activeBuffer) return [""];
          return activeBuffer.content.split("\n");
        },

        getLineTokens: () => {
          // Get tokens from the centralized token service
          return tokenService.convertToEditorLineTokens();
        },

        getContent: () => {
          const activeBuffer = useBufferStore.getState().actions.getActiveBuffer();
          return activeBuffer?.content || "";
        },
      },
    }),
    isEqual,
  ),
);

// Subscribe to buffer changes and update computed values
useBufferStore.subscribe((state) => {
  const activeBuffer = state.actions.getActiveBuffer();
  if (activeBuffer) {
    useEditorViewStore.setState({
      lines: activeBuffer.content.split("\n"),
      lineTokens: tokenService.convertToEditorLineTokens(),
    });
  } else {
    useEditorViewStore.setState({
      lines: [""],
      lineTokens: new Map(),
    });
  }
});
