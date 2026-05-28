export function formatDatabaseClipboardValue(value: unknown): string {
  if (value === null || value === undefined) return "NULL";

  if (typeof value === "object") {
    try {
      return JSON.stringify(value, null, 2) ?? String(value);
    } catch {
      return String(value);
    }
  }

  return String(value);
}

export async function writeDatabaseClipboardText(text: string): Promise<boolean> {
  try {
    const writeText = globalThis.navigator?.clipboard?.writeText;
    if (!writeText) return false;
    await writeText.call(globalThis.navigator.clipboard, text);
    return true;
  } catch {
    return false;
  }
}
