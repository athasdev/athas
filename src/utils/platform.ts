// Platform detection and cross-platform API utilities
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { open as tauriOpen } from "@tauri-apps/plugin-dialog";

// Detect if we're on macOS
export const isMac = (): boolean => {
  return (
    /Mac|iPhone|iPod|iPad/.test(navigator.platform) ||
    /Mac/.test(navigator.userAgent) ||
    navigator.platform === "MacIntel"
  );
};

// Get the appropriate modifier key symbol for the platform
export const getModifierSymbol = (): string => {
  return isMac() ? "⌘" : "Ctrl";
};

// Get keyboard shortcut text for display
export const getShortcutText = (key: string, modifiers: string[] = []): string => {
  const modSymbol = isMac() ? "⌘" : "Ctrl";
  const shiftSymbol = isMac() ? "⇧" : "Shift";

  let result = "";

  if (modifiers.includes("ctrl") || modifiers.includes("cmd")) {
    result += modSymbol;
  }

  if (modifiers.includes("shift")) {
    result += shiftSymbol;
  }

  // Convert arrow keys to symbols
  const keyMap: { [key: string]: string } = {
    ArrowRight: "→",
    ArrowLeft: "←",
    ArrowUp: "↑",
    ArrowDown: "↓",
    "\\": "\\",
    w: "W",
  };

  result += keyMap[key] || key.toUpperCase();

  return result;
};

// File dialog
export const openFolder = async (): Promise<string | null> => {
  try {
    const selected = await tauriOpen({
      directory: true,
      multiple: false,
    });
    return selected as string | null;
  } catch (error) {
    console.error("Error opening folder with Tauri:", error);
    return null;
  }
};

// Directory reading
export const readDirectory = async (path: string): Promise<any[]> => {
  try {
    return await tauriInvoke("read_directory_custom", { path });
  } catch (error) {
    console.error("Error reading directory with Tauri:", error);
    return [];
  }
};

// File reading
export const readFile = async (path: string): Promise<string> => {
  try {
    return await tauriInvoke("read_file_custom", { path });
  } catch (error) {
    console.error("Error reading file with Tauri:", error);
    return `Error reading file: ${error}`;
  }
};

// File writing
export const writeFile = async (path: string, content: string): Promise<void> => {
  try {
    await tauriInvoke("write_file_custom", { path, content });
  } catch (error) {
    console.error("Error writing file with Tauri:", error);
    throw error;
  }
};

export const createDirectory = async (path: string): Promise<void> => {
  try {
    await tauriInvoke("create_directory_custom", { path });
  } catch (error) {
    console.error("Error creating directory with Tauri:", error);
    throw error;
  }
};

export const deletePath = async (path: string): Promise<void> => {
  try {
    await tauriInvoke("delete_path_custom", { path });
  } catch (error) {
    console.error("Error deleting path with Tauri:", error);
    throw error;
  }
};
