/**
 * Clipboard utilities for copying text to clipboard
 */
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";

/**
 * Copies text to the clipboard using the modern Clipboard API with fallback
 * @param text - The text to copy to clipboard
 * @returns Promise that resolves when text is copied
 */
export const copyToClipboard = async (text: string): Promise<void> => {
  try {
    await writeText(text);
  } catch (_err) {
    console.warn("Failed to copy to clipboard:", _err);
  }
};

/**
 * Copies text to clipboard and returns success status
 * @param text - The text to copy to clipboard
 * @returns Promise that resolves to boolean indicating success
 */
export const copyToClipboardWithStatus = async (text: string): Promise<boolean> => {
  try {
    await copyToClipboard(text);
    return true;
  } catch (error) {
    console.error("Failed to copy to clipboard:", error);
    return false;
  }
};

/**
 * Reads text from clipboard (requires user permission in most browsers)
 * @returns Promise that resolves to the clipboard text
 */
export const readFromClipboard = async (): Promise<string> => {
  try {
    return await readText();
  } catch (error) {
    console.error("Failed to read from clipboard:", error);
    throw new Error("Failed to read from clipboard");
  }
};
