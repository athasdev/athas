import { invoke } from "@tauri-apps/api/core";
import { loadCustomThemes } from "./custom-theme-store";
import { toThemeDefinition } from "./theme-file";
import { themeLoader } from "./theme-loader";
import { themeRegistry } from "./theme-registry";

let isThemeSystemInitialized = false;

// Helper function to rebuild native menu with current themes
const rebuildNativeMenu = async () => {
  try {
    const themes = themeRegistry.getAllThemes();
    const themeData = themes.map((theme) => ({
      id: theme.id,
      name: theme.name,
      category: theme.category,
    }));

    await invoke("rebuild_menu_themes", { themes: themeData });
  } catch (error) {
    console.error("Failed to rebuild native menu:", error);
  }
};

export const initializeThemeSystem = async () => {
  if (isThemeSystemInitialized) {
    return;
  }

  try {
    isThemeSystemInitialized = true;

    try {
      await themeLoader.initialize();
    } catch (error) {
      console.error("initializeThemeSystem: Failed to load themes:", error);
    }

    try {
      const customThemes = await loadCustomThemes();
      for (const theme of customThemes) {
        const definition = toThemeDefinition(theme);
        if (themeRegistry.getTheme(definition.id)) {
          console.warn(
            `initializeThemeSystem: Skipped custom theme "${definition.id}" because that ID is already registered`,
          );
          continue;
        }
        themeRegistry.registerTheme(definition, {
          extensionId: `custom-theme.${definition.id}`,
          kind: "custom",
        });
      }
    } catch (error) {
      console.error("initializeThemeSystem: Failed to load custom themes:", error);
    }

    // Mark theme registry as ready
    themeRegistry.markAsReady();

    // Rebuild native menu with loaded themes
    await rebuildNativeMenu();

    // Listen for theme registry changes and rebuild menu
    themeRegistry.onRegistryChange(() => {
      rebuildNativeMenu();
    });
  } catch (error) {
    console.error("Failed to initialize theme system:", error);
    isThemeSystemInitialized = false; // Reset flag on error
  }
};
