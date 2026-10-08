import { type DialogFilter, open, save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";

interface PickOptions {
  title?: string;
  filters?: DialogFilter[];
}

interface SaveOptions {
  defaultPath?: string;
  filters?: DialogFilter[];
}

export async function pickDirectory(options: Omit<PickOptions, "filters"> = {}) {
  const selected = await open({ ...options, directory: true, multiple: false });
  return typeof selected === "string" ? selected : null;
}

export async function pickFile(options: PickOptions = {}) {
  const selected = await open({ ...options, directory: false, multiple: false });
  return typeof selected === "string" ? selected : null;
}

export async function pickFiles(options: PickOptions = {}): Promise<string[]> {
  const selected = await open({ ...options, directory: false, multiple: true });
  if (!selected) return [];
  return Array.isArray(selected) ? selected : [selected];
}

export async function pickSavePath(options: SaveOptions): Promise<string | null> {
  return await save(options);
}

export async function saveTextFileWithDialog(
  options: SaveOptions,
  getContents: () => string,
): Promise<string | null> {
  const targetPath = await save(options);
  if (!targetPath) return null;
  await writeTextFile(targetPath, getContents());
  return targetPath;
}
