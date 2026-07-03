import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { createAppWindow } from "@/features/window/utils/create-app-window";
import { isLinux, isMac } from "@/utils/platform";

export function toggleFullscreen(): void {
  window.dispatchEvent(new CustomEvent("toggle-fullscreen"));
}

export function toggleFullscreenMac(): void {
  if (isMac()) {
    window.dispatchEvent(new CustomEvent("toggle-fullscreen"));
  }
}

export function createNewWindow(): void {
  void createAppWindow();
}

export function minimizeWindow(): void {
  window.dispatchEvent(new CustomEvent("minimize-window"));
}

export function minimizeWindowMac(): void {
  if (isMac()) {
    window.dispatchEvent(new CustomEvent("minimize-window"));
  }
}

export function minimizeWindowAlt(): void {
  if (!isMac()) {
    window.dispatchEvent(new CustomEvent("minimize-window"));
  }
}

export function maximizeWindow(): void {
  if (!isMac()) {
    window.dispatchEvent(new CustomEvent("maximize-window"));
  }
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

  const { invoke } = await import("@tauri-apps/api/core");
  invoke("toggle_menu_bar").catch(console.error);
}
