import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { FontInfo } from "@/stores/types/font";
import { createSelectors } from "@/utils/zustand-selectors";

interface FontState {
  availableFonts: FontInfo[];
  monospaceFonts: FontInfo[];
  isLoading: boolean;
  error: string | null;
  lastCacheTime: number | null;
  actions: FontActions;
}

interface FontActions {
  loadAvailableFonts: (forceRefresh?: boolean) => Promise<void>;
  loadMonospaceFonts: (forceRefresh?: boolean) => Promise<void>;
  validateFont: (fontFamily: string) => Promise<boolean>;
  clearCacheAndReload: () => void;
  clearError: () => void;
}

const FONT_CACHE_KEY = "athas_font_cache";
const FONT_CACHE_EXPIRY = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

interface FontCache {
  availableFonts: FontInfo[];
  monospaceFonts: FontInfo[];
  timestamp: number;
}

const loadFontsFromCache = (): FontCache | null => {
  try {
    const cached = localStorage.getItem(FONT_CACHE_KEY);
    if (!cached) return null;

    const cache: FontCache = JSON.parse(cached);
    const now = Date.now();

    // Check if cache is expired
    if (now - cache.timestamp > FONT_CACHE_EXPIRY) {
      localStorage.removeItem(FONT_CACHE_KEY);
      return null;
    }

    return cache;
  } catch (error) {
    console.error("Failed to load fonts from cache:", error);
    localStorage.removeItem(FONT_CACHE_KEY);
    return null;
  }
};

const saveFontsToCache = (availableFonts: FontInfo[], monospaceFonts: FontInfo[]) => {
  try {
    const cache: FontCache = {
      availableFonts,
      monospaceFonts,
      timestamp: Date.now(),
    };
    localStorage.setItem(FONT_CACHE_KEY, JSON.stringify(cache));
  } catch (error) {
    console.error("Failed to save fonts to cache:", error);
  }
};

export const useFontStore = createSelectors(
  create<FontState>()(
    immer((set, get) => {
      // Try to load from cache immediately
      const cache = loadFontsFromCache();
      const initialValues = cache
        ? {
            availableFonts: cache.availableFonts,
            monospaceFonts: cache.monospaceFonts,
            isLoading: false,
            error: null,
            lastCacheTime: cache.timestamp,
          }
        : {
            availableFonts: [],
            monospaceFonts: [],
            isLoading: false,
            error: null,
            lastCacheTime: null,
          };

      if (cache) {
        console.log("Initializing with cached fonts:", cache.availableFonts.length, "fonts");
      }

      // Add web fonts as custom fonts
      const webFonts: FontInfo[] = [
        { family: "Space Grotesk", name: "Space Grotesk", style: "Regular", is_monospace: false },
      ];

      return {
        ...initialValues,
        availableFonts: [...webFonts, ...initialValues.availableFonts],
        actions: {
          loadAvailableFonts: async (forceRefresh = false) => {
            const current = get();

            // Use cached data if available and not forcing refresh
            // But only if we have more than just the web fonts
            if (!forceRefresh && current.availableFonts.length > 1) {
              console.log("Using already loaded fonts");
              return;
            }

            set((state) => {
              state.isLoading = true;
              state.error = null;
            });

            try {
              console.log("Loading fonts from system...");
              const fonts = await invoke<FontInfo[]>("get_system_fonts");
              const monospaceFonts = fonts.filter((font) => font.is_monospace);

              // Add web fonts
              const webFonts: FontInfo[] = [
                {
                  family: "Space Grotesk",
                  name: "Space Grotesk",
                  style: "Regular",
                  is_monospace: false,
                },
              ];

              set((state) => {
                state.availableFonts = [...webFonts, ...fonts];
                state.monospaceFonts = monospaceFonts;
                state.isLoading = false;
                state.lastCacheTime = Date.now();
              });

              // Save to cache
              saveFontsToCache([...webFonts, ...fonts], monospaceFonts);
              console.log("Loaded and cached", fonts.length + webFonts.length, "fonts");
            } catch (error) {
              console.error("Failed to load fonts:", error);
              set((state) => {
                state.error = error instanceof Error ? error.message : "Failed to load fonts";
                state.isLoading = false;
              });
            }
          },

          loadMonospaceFonts: async (forceRefresh = false) => {
            const current = get();

            // Use cached data if available and not forcing refresh
            // Ensure we have actual fonts loaded
            if (!forceRefresh && current.monospaceFonts.length > 0 && !current.isLoading) {
              console.log("Using already loaded monospace fonts");
              return;
            }

            set((state) => {
              state.isLoading = true;
              state.error = null;
            });

            try {
              console.log("Loading monospace fonts from system...");
              const fonts = await invoke<FontInfo[]>("get_monospace_fonts");

              set((state) => {
                state.monospaceFonts = fonts;
                state.isLoading = false;
                state.lastCacheTime = Date.now();
              });

              // Update cache - we need all fonts for proper caching
              const updatedState = get();
              if (updatedState.availableFonts.length > 0) {
                saveFontsToCache(updatedState.availableFonts, fonts);
              }

              console.log("Loaded and cached", fonts.length, "monospace fonts");
            } catch (error) {
              console.error("Failed to load monospace fonts:", error);
              set((state) => {
                state.error =
                  error instanceof Error ? error.message : "Failed to load monospace fonts";
                state.isLoading = false;
              });
            }
          },

          validateFont: async (fontFamily: string): Promise<boolean> => {
            try {
              return await invoke<boolean>("validate_font", { fontFamily });
            } catch (error) {
              console.error("Failed to validate font:", error);
              return false;
            }
          },

          clearCacheAndReload: () => {
            localStorage.removeItem(FONT_CACHE_KEY);
            set((state) => {
              state.availableFonts = [];
              state.monospaceFonts = [];
              state.lastCacheTime = null;
            });
            // The next call to loadAvailableFonts will reload from system
          },

          clearError: () => {
            set((state) => {
              state.error = null;
            });
          },
        },
      };
    }),
  ),
);
