import { commands } from "@/bindings/commands";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { createAppWindow } from "@/features/window/services/create-app-window";
import {
  maximizeWindow,
  minimizeWindow,
  toggleWindowFullscreen,
  toggleWindowMaximize,
} from "@/features/window/services/native-window-api";
import { isLinux, isMac } from "@/utils/platform";

function runWindowAction(action: () => Promise<void>, label: string): void {
  action().catch((error) => console.error(`Failed to ${label}:`, error));
}

export function toggleFullscreen(): void {
  runWindowAction(toggleWindowFullscreen, "toggle fullscreen");
}

export function toggleFullscreenMac(): void {
  if (isMac()) toggleFullscreen();
}

export function createNewWindow(): void {
  void createAppWindow();
}

export function minimizeCurrentWindow(): void {
  runWindowAction(minimizeWindow, "minimize window");
}

export function minimizeWindowMac(): void {
  if (isMac()) minimizeCurrentWindow();
}

export function minimizeWindowAlt(): void {
  if (!isMac()) minimizeCurrentWindow();
}

export function maximizeCurrentWindow(): void {
  if (!isMac()) runWindowAction(maximizeWindow, "maximize window");
}

export function toggleCurrentWindowMaximize(): void {
  runWindowAction(toggleWindowMaximize, "toggle maximize");
}

export async function quitApplication(): Promise<void> {
  if (!isMac()) return;

  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().close();
}

export async function toggleNativeMenuBar(): Promise<void> {
  if (isMac() || isLinux()) return;

  const { settings } = useSettingsStore.getState();
  if (!settings.nativeMenuBar) return;

  commands.toggleMenuBar(null).catch(console.error);
}
