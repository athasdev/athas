import { openUrl } from "@tauri-apps/plugin-opener";

export async function openExternalUrl(url: string | URL): Promise<void> {
  await openUrl(url);
}
