import { create } from "zustand";
import { type EditorConfigProperties, fetchEditorConfigProperties } from "../api/editorconfig";

interface EditorConfigState {
  propertiesCache: Record<string, EditorConfigProperties>;
  actions: {
    resolveProperties: (filePath: string) => Promise<EditorConfigProperties>;
    invalidateCache: (filePath?: string) => void;
  };
}

export const useEditorConfigStore = create<EditorConfigState>()((set, get) => ({
  propertiesCache: {},
  actions: {
    resolveProperties: async (filePath: string) => {
      const cached = get().propertiesCache[filePath];
      if (cached) return cached;

      const properties = await fetchEditorConfigProperties(filePath);
      set((state) => ({
        propertiesCache: { ...state.propertiesCache, [filePath]: properties },
      }));
      return properties;
    },
    invalidateCache: (filePath?: string) => {
      if (filePath) {
        set((state) => {
          const { [filePath]: _, ...rest } = state.propertiesCache;
          return { propertiesCache: rest };
        });
      } else {
        set({ propertiesCache: {} });
      }
    },
  },
}));

function handleEditorConfigChange(event: Event) {
  const path: string = (event as CustomEvent).detail?.path || "";
  if (path.endsWith(".editorconfig")) {
    useEditorConfigStore.getState().actions.invalidateCache();
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("file-changed", handleEditorConfigChange);
  window.addEventListener("file-external-change", handleEditorConfigChange);
}
