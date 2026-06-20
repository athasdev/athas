export async function readClipboardText(): Promise<string> {
  try {
    const { readText } = await import("@tauri-apps/plugin-clipboard-manager");
    return await readText();
  } catch {
    const readText = globalThis.navigator?.clipboard?.readText;
    if (!readText) {
      throw new Error("Clipboard read API is unavailable.");
    }
    return readText.call(globalThis.navigator.clipboard);
  }
}

export async function writeClipboardText(text: string): Promise<void> {
  try {
    const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
    await writeText(text);
  } catch {
    const writeText = globalThis.navigator?.clipboard?.writeText;
    if (!writeText) {
      throw new Error("Clipboard write API is unavailable.");
    }
    await writeText.call(globalThis.navigator.clipboard, text);
  }
}

export async function tryWriteClipboardText(text: string): Promise<boolean> {
  try {
    await writeClipboardText(text);
    return true;
  } catch {
    return false;
  }
}
