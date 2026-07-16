import { invoke } from "@tauri-apps/api/core";
import { extensionManager } from "@/features/editor/extensions/manager";
import type { EditorAPI } from "@/features/editor/types/editor-extension.types";
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

    // Initialize extension manager if not already done
    if (!extensionManager.isInitialized()) {
      extensionManager.initialize();
    }

    // Create a dummy editor API for theme extensions (they don't need editor functionality)
    const dummyEditorAPI: EditorAPI = {
      getContent: () => "",
      setContent: () => {},
      insertText: () => {},
      deleteRange: () => {},
      replaceRange: () => {},
      getSelection: () => null,
      setSelection: () => {},
      getCursorPosition: () => ({ line: 0, column: 0, offset: 0 }),
      setCursorPosition: () => {},
      selectAll: () => {},
      addDecoration: () => "",
      removeDecoration: () => {},
      updateDecoration: () => {},
      clearDecorations: () => {},
      getLines: () => [],
      getLine: () => undefined,
      getLineCount: () => 0,
      duplicateLine: () => {},
      deleteLine: () => {},
      toggleComment: () => {},
      goToMatchingBracket: () => {},
      selectToBracket: () => {},
      removeBrackets: () => {},
      expandSelection: () => {},
      shrinkSelection: () => {},
      insertCursorAbove: () => {},
      insertCursorBelow: () => {},
      insertCursorsAtLineEnds: () => {},
      moveLineUp: () => {},
      moveLineDown: () => {},
      copyLineUp: () => {},
      copyLineDown: () => {},
      undo: () => {},
      redo: () => {},
      canUndo: () => false,
      canRedo: () => false,
      addSelectionToNextFindMatch: () => false,
      addSelectionToPreviousFindMatch: () => false,
      selectAllFindMatches: () => false,
      getSettings: () => ({
        fontSize: 14,
        lineHeight: 1.4,
        tabSize: 2,
        lineNumbers: true,
        wordWrap: false,
        renderWhitespace: "none",
        renderIndentGuides: true,
        theme: "athas-dark",
      }),
      updateSettings: () => {},
      on: () => () => {},
      off: () => {},
      emitEvent: () => {},
    };

    extensionManager.setEditor(dummyEditorAPI);

    // Load theme loader
    try {
      await extensionManager.loadExtension(themeLoader);
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
