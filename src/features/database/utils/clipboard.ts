import { tryWriteClipboardText } from "@/utils/clipboard";

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
  return tryWriteClipboardText(text);
}
