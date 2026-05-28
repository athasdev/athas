import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { FontInfo } from "@/features/settings/stores/types/font";
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
const FALLBACK_FONTS: FontInfo[] = [
  {
    name: "IBM Plex Sans Variable",
    family: "IBM Plex Sans Variable",
    style: "Regular",
    is_monospace: false,
  },
  {
    name: "JetBrains Mono Variable",
    family: "JetBrains Mono Variable",
    style: "Regular",
    is_monospace: true,
  },
];

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

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return String(error);
};

const isTauriBridgeError = (error: unknown): boolean => {
  const message = getErrorMessage(error);
  return message.includes("postMessage") || message.includes("__TAURI_INTERNALS__");
};

const getFallbackMonospaceFonts = () => FALLBACK_FONTS.filter((font) => font.is_monospace);

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

      return {
        ...initialValues,
        actions: {
          loadAvailableFonts: async (forceRefresh = false) => {
            const current = get();

            // Use cached data if available and not forcing refresh
            // But only if we have more than just the web fonts
            if (!forceRefresh && current.availableFonts.length > 1) {
              return;
            }

            set((state) => {
              state.isLoading = true;
              state.error = null;
            });

            try {
              const fonts = await invoke<FontInfo[]>("get_system_fonts");
              const monospaceFonts = fonts.filter((font) => font.is_monospace);

              set((state) => {
                state.availableFonts = fonts;
                state.monospaceFonts = monospaceFonts;
                state.isLoading = false;
                state.lastCacheTime = Date.now();
              });

              // Save to cache
              saveFontsToCache(fonts, monospaceFonts);
            } catch (error) {
              console.error("Failed to load fonts:", error);
              if (isTauriBridgeError(error)) {
                const monospaceFonts = getFallbackMonospaceFonts();
                set((state) => {
                  state.availableFonts = FALLBACK_FONTS;
                  state.monospaceFonts = monospaceFonts;
                  state.error = null;
                  state.isLoading = false;
                  state.lastCacheTime = Date.now();
                });
                saveFontsToCache(FALLBACK_FONTS, monospaceFonts);
                return;
              }

              set((state) => {
                state.error = getErrorMessage(error) || "Failed to load fonts";
                state.isLoading = false;
              });
            }
          },

          loadMonospaceFonts: async (forceRefresh = false) => {
            const current = get();

            // Use cached data if available and not forcing refresh
            // Ensure we have actual fonts loaded
            if (!forceRefresh && current.monospaceFonts.length > 0 && !current.isLoading) {
              return;
            }

            set((state) => {
              state.isLoading = true;
              state.error = null;
            });

            try {
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
            } catch (error) {
              console.error("Failed to load monospace fonts:", error);
              if (isTauriBridgeError(error)) {
                const fonts = getFallbackMonospaceFonts();
                set((state) => {
                  state.monospaceFonts = fonts;
                  state.error = null;
                  state.isLoading = false;
                  state.lastCacheTime = Date.now();
                });

                const updatedState = get();
                saveFontsToCache(
                  updatedState.availableFonts.length > 0
                    ? updatedState.availableFonts
                    : FALLBACK_FONTS,
                  fonts,
                );
                return;
              }

              set((state) => {
                state.error = getErrorMessage(error) || "Failed to load monospace fonts";
                state.isLoading = false;
              });
            }
          },

          validateFont: async (fontFamily: string): Promise<boolean> => {
            try {
              return await invoke<boolean>("validate_font", { fontFamily });
            } catch (error) {
              console.error("Failed to validate font:", error);
              if (isTauriBridgeError(error)) {
                return FALLBACK_FONTS.some((font) => font.family === fontFamily);
              }
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
