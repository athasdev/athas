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

// Check if we're running in Tauri
export const isTauri = (): boolean => {
  // Method 1: Check for __TAURI__ global
  if (typeof window !== "undefined" && "__TAURI__" in window && window.__TAURI__ !== undefined) {
    return true;
  }

  // Method 2: Check for __TAURI_INTERNALS__ (Tauri v2)
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    return true;
  }

  // Method 3: Check for tauri:// protocol (Tauri specific)
  if (typeof window !== "undefined" && window.location && window.location.protocol === "tauri:") {
    return true;
  }

  // Method 4: Check if we can import Tauri APIs (they exist in bundled environment)
  try {
    if (typeof tauriInvoke === "function") {
      return true;
    }
  } catch (_error) {
    // Ignore error
  }

  // Method 5: Check for absence of standard browser APIs (fallback)
  if (typeof window !== "undefined" && !window.location.protocol.startsWith("http")) {
    return true;
  }

  return false;
};

// Cross-platform file dialog
export const openFolder = async (): Promise<string | FileList | null> => {
  if (isTauri()) {
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
  } else {
    // Web fallback using HTML5 File API
    return new Promise(resolve => {
      const input = document.createElement("input");
      input.type = "file";
      input.webkitdirectory = true;
      input.multiple = true;

      input.onchange = event => {
        const files = (event.target as HTMLInputElement).files;
        if (files && files.length > 0) {
          // Cache the files immediately
          setWebFiles(files);
          resolve(files); // Return the FileList for web
        } else {
          resolve(null);
        }
      };

      input.oncancel = () => resolve(null);
      input.click();
    });
  }
};

// Cross-platform directory reading
export const readDirectory = async (path: string): Promise<any[]> => {
  if (isTauri()) {
    try {
      return await tauriInvoke("read_directory_custom", { path });
    } catch (error) {
      console.error("Error reading directory with Tauri:", error);
      return [];
    }
  } else {
    // Web fallback - we'll need to cache the files from the folder selection
    const cachedFiles = getCachedWebFiles(path);
    return cachedFiles;
  }
};

// Cross-platform file reading
export const readFile = async (path: string): Promise<string> => {
  if (isTauri()) {
    try {
      return await tauriInvoke("read_file_custom", { path });
    } catch (error) {
      console.error("Error reading file with Tauri:", error);
      return `Error reading file: ${error}`;
    }
  } else {
    // Web fallback - get file from cache
    const file = getCachedWebFile(path);
    if (file) {
      try {
        return await file.text();
      } catch (error) {
        console.error("Error reading web file:", error);
        return `Error reading file: ${error}`;
      }
    }
    return "File not found in web cache";
  }
};

// Cross-platform file writing
export const writeFile = async (path: string, content: string): Promise<void> => {
  if (isTauri()) {
    try {
      await tauriInvoke("write_file_custom", { path, content });
    } catch (error) {
      console.error("Error writing file with Tauri:", error);
      throw error;
    }
  } else {
    // Web fallback - trigger download of modified file
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = path.split("/").pop() || "file.txt";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    // Also update the cached file content
    updateCachedWebFile(path, content);
  }
};

export const createDirectory = async (path: string): Promise<void> => {
  if (isTauri()) {
    try {
      await tauriInvoke("create_directory_custom", { path });
    } catch (error) {
      console.error("Error creating directory with Tauri:", error);
      throw error;
    }
  } else {
    console.log("Directory creation simulated for web:", path);
  }
};

export const deletePath = async (path: string): Promise<void> => {
  if (isTauri()) {
    try {
      await tauriInvoke("delete_path_custom", { path });
    } catch (error) {
      console.error("Error deleting path with Tauri:", error);
      throw error;
    }
  } else {
    console.log("Path deletion simulated for web:", path);
  }
};

// Web-specific file caching (since we can't access filesystem directly)
const webFileCache: Map<string, File> = new Map();
const webFileStructure: Map<string, any[]> = new Map();

export const setWebFiles = (files: FileList) => {
  webFileCache.clear();
  webFileStructure.clear();

  // Build file structure from FileList
  const structure: any = {};

  Array.from(files).forEach(file => {
    const path = file.webkitRelativePath;
    const pathParts = path.split("/");

    // Cache the file
    webFileCache.set(path, file);

    // Build directory structure
    let current = structure;
    for (let i = 0; i < pathParts.length - 1; i++) {
      const part = pathParts[i];
      if (!current[part]) {
        current[part] = {};
      }
      current = current[part];
    }
  });

  // Convert structure to format expected by the app
  const convertStructure = (obj: any, basePath: string = ""): any[] => {
    return Object.keys(obj).map(key => {
      const fullPath = basePath ? `${basePath}/${key}` : key;
      const isDir = typeof obj[key] === "object" && Object.keys(obj[key]).length > 0;

      return {
        name: key,
        path: fullPath,
        is_dir: isDir,
        children: isDir ? convertStructure(obj[key], fullPath) : undefined,
      };
    });
  };

  // Cache directory structures
  const rootStructure = convertStructure(structure);
  webFileStructure.set("", rootStructure);

  // Cache subdirectory structures
  const cacheSubdirectories = (items: any[], _basePath: string = "") => {
    items.forEach(item => {
      if (item.is_dir && item.children) {
        webFileStructure.set(item.path, item.children);
        cacheSubdirectories(item.children, item.path);
      }
    });
  };

  cacheSubdirectories(rootStructure);
};

const getCachedWebFiles = (path: string): any[] => {
  return webFileStructure.get(path) || [];
};

const getCachedWebFile = (path: string): File | undefined => {
  return webFileCache.get(path);
};

const updateCachedWebFile = (path: string, content: string): void => {
  // Create a new File object with updated content
  const file = new File([content], path.split("/").pop() || "file.txt", { type: "text/plain" });
  webFileCache.set(path, file);
};
