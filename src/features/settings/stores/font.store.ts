import { BUNDLED_FONTS } from "@/features/settings/config/bundled-fonts";
import { commands } from "@/bindings/commands";
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { FontInfo } from "@/features/settings/types/font.types";
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

const FONT_CACHE_KEY = "athas_font_cache_v3";
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

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return String(error);
};

const isTauriBridgeError = (error: unknown): boolean => {
  const message = getErrorMessage(error);
  return message.includes("postMessage") || message.includes("__TAURI_INTERNALS__");
};

const getFallbackMonospaceFonts = () => BUNDLED_FONTS.filter((font) => font.is_monospace);

const isSameFontList = (current: FontInfo[], next: FontInfo[]) =>
  current.length === next.length &&
  current.every(
    (font, index) =>
      font.family === next[index].family && font.is_monospace === next[index].is_monospace,
  );

export const useFontStore = createSelectors(
  create<FontState>()(
    immer((set, get) => {
      // One system scan at a time per list; callers that ask while one runs share it.
      let availableFontsRequest: Promise<void> | null = null;
      let monospaceFontsRequest: Promise<void> | null = null;

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
          loadAvailableFonts: (forceRefresh = false) => {
            const current = get();

            // Use cached data if available and not forcing refresh
            // But only if we have more than just the web fonts
            if (!forceRefresh && current.availableFonts.length > 1) {
              return Promise.resolve();
            }

            availableFontsRequest ??= (async () => {
              // A refresh of a list that is already showing runs in the background, so pickers
              // keep their list instead of flashing a spinner while the system is scanned.
              const isRefresh = get().availableFonts.length > 0;
              if (!isRefresh) {
                set((state) => {
                  state.isLoading = true;
                  state.error = null;
                });
              }

              try {
                const fonts = await commands.getSystemFonts();
                const monospaceFonts = fonts.filter((font) => font.is_monospace);

                set((state) => {
                  if (!isSameFontList(state.availableFonts, fonts)) state.availableFonts = fonts;
                  if (!isSameFontList(state.monospaceFonts, monospaceFonts)) {
                    state.monospaceFonts = monospaceFonts;
                  }
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
                    state.availableFonts = BUNDLED_FONTS;
                    state.monospaceFonts = monospaceFonts;
                    state.error = null;
                    state.isLoading = false;
                    state.lastCacheTime = Date.now();
                  });
                  saveFontsToCache(BUNDLED_FONTS, monospaceFonts);
                  return;
                }

                set((state) => {
                  if (!isRefresh) state.error = getErrorMessage(error) || "Failed to load fonts";
                  state.isLoading = false;
                });
              }
            })().finally(() => {
              availableFontsRequest = null;
            });
            return availableFontsRequest;
          },

          loadMonospaceFonts: (forceRefresh = false) => {
            const current = get();

            // Use cached data if available and not forcing refresh
            // Ensure we have actual fonts loaded
            if (!forceRefresh && current.monospaceFonts.length > 0 && !current.isLoading) {
              return Promise.resolve();
            }

            monospaceFontsRequest ??= (async () => {
              const isRefresh = get().monospaceFonts.length > 0;
              if (!isRefresh) {
                set((state) => {
                  state.isLoading = true;
                  state.error = null;
                });
              }

              try {
                const fonts = await commands.getMonospaceFonts();

                set((state) => {
                  if (!isSameFontList(state.monospaceFonts, fonts)) state.monospaceFonts = fonts;
                  state.isLoading = false;
                  state.lastCacheTime = Date.now();
                });

                // Update cache - we need all fonts for proper caching
                const updatedState = get();
                if (updatedState.availableFonts.length > 0) {
                  saveFontsToCache(updatedState.availableFonts, updatedState.monospaceFonts);
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
                      : BUNDLED_FONTS,
                    fonts,
                  );
                  return;
                }

                set((state) => {
                  if (!isRefresh) {
                    state.error = getErrorMessage(error) || "Failed to load monospace fonts";
                  }
                  state.isLoading = false;
                });
              }
            })().finally(() => {
              monospaceFontsRequest = null;
            });
            return monospaceFontsRequest;
          },

          validateFont: async (fontFamily: string): Promise<boolean> => {
            if (BUNDLED_FONTS.some((font) => font.family === fontFamily)) return true;
            try {
              return await commands.validateFont(fontFamily);
            } catch (error) {
              console.error("Failed to validate font:", error);
              if (isTauriBridgeError(error)) {
                return BUNDLED_FONTS.some((font) => font.family === fontFamily);
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
