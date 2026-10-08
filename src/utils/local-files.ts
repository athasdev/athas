import { homeDir } from "@tauri-apps/api/path";
import { exists, readDir, readFile } from "@tauri-apps/plugin-fs";
import { commands } from "@/bindings/commands";

export async function readFileBytes(path: string) {
  return await readFile(path);
}

export async function pathExists(path: string): Promise<boolean> {
  return await exists(path);
}

export async function listDirectoryEntries(path: string) {
  return await readDir(path);
}

export async function getHomeDirectory(): Promise<string> {
  return await homeDir();
}

export async function openFileInDefaultApp(path: string): Promise<void> {
  await commands.openFileExternal(path);
}

export async function toggleQuickLookPreview(path: string): Promise<void> {
  await commands.toggleQuickLook(path);
}

export async function showSystemSharePicker(path: string): Promise<void> {
  await commands.showSharePicker(path);
}
