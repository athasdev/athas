import { load, type Store } from "@tauri-apps/plugin-store";
import { parseThemeFile } from "./theme-file";
import type { Theme } from "./theme-schema";

const CUSTOM_THEME_STORE_FILE = "custom-themes.json";
const CUSTOM_THEME_STORE_KEY = "themes";

let storeInstance: Store | undefined;

async function getCustomThemeStore(): Promise<Store> {
  if (!storeInstance) {
    storeInstance = await load(CUSTOM_THEME_STORE_FILE, {
      autoSave: true,
    } as Parameters<typeof load>[1]);
  }
  return storeInstance;
}

export function mergeCustomThemes(current: Theme[], incoming: Theme[]): Theme[] {
  const merged = new Map(current.map((theme) => [theme.id, theme]));
  for (const theme of incoming) {
    merged.set(theme.id, theme);
  }
  return Array.from(merged.values());
}

export async function loadCustomThemes(): Promise<Theme[]> {
  const store = await getCustomThemeStore();
  const storedThemes = await store.get<unknown>(CUSTOM_THEME_STORE_KEY);
  if (storedThemes === null || storedThemes === undefined) return [];

  return parseThemeFile({ name: "Custom themes", themes: storedThemes }).themes;
}

export async function saveCustomThemes(themes: Theme[]): Promise<void> {
  const store = await getCustomThemeStore();
  await store.set(CUSTOM_THEME_STORE_KEY, themes);
  await store.save();
}

export async function installCustomThemes(themes: Theme[]): Promise<Theme[]> {
  const merged = mergeCustomThemes(await loadCustomThemes(), themes);
  await saveCustomThemes(merged);
  return merged;
}

export async function removeCustomTheme(themeId: string): Promise<void> {
  const themes = await loadCustomThemes();
  await saveCustomThemes(themes.filter((theme) => theme.id !== themeId));
}
