import { readClipboardText, writeClipboardText } from "@/utils/clipboard";

export async function readEditorClipboardText(): Promise<string> {
  return readClipboardText();
}

export async function writeEditorClipboardText(text: string): Promise<void> {
  await writeClipboardText(text);
}
