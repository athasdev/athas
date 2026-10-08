import { getAllWindows, getCurrentWindow } from "@tauri-apps/api/window";
import { exit } from "@tauri-apps/plugin-process";
import { commands } from "@/bindings/commands";

export const showNativeChoiceSheet = (
  message: string,
  informativeText: string,
  primaryLabel: string,
  secondaryLabel: string,
  cancelLabel: string,
) =>
  commands.showNativeChoiceSheet(
    message,
    informativeText,
    primaryLabel,
    secondaryLabel,
    cancelLabel,
  );

export const reopenWebviewDevtools = () => commands.reopenCurrentWebviewDevtools();

export const setNativeMenuBarEnabled = (enabled: boolean) => commands.toggleMenuBar(enabled);

export async function quitApp(): Promise<void> {
  await exit(0);
}

export async function toggleWindowFullscreen(): Promise<void> {
  const currentWindow = getCurrentWindow();
  await currentWindow.setFullscreen(!(await currentWindow.isFullscreen()));
}

export async function minimizeWindow(): Promise<void> {
  await getCurrentWindow().minimize();
}

export async function maximizeWindow(): Promise<void> {
  await getCurrentWindow().maximize();
}

export async function toggleWindowMaximize(): Promise<void> {
  await getCurrentWindow().toggleMaximize();
}

/** Whether any Athas window has focus, for deciding whether a native notification is needed. */
export async function isAnyAthasWindowFocused(): Promise<boolean> {
  try {
    const windows = await getAllWindows();
    const focusStates = await Promise.all(windows.map((window) => window.isFocused()));
    return focusStates.some(Boolean);
  } catch {
    if (typeof document === "undefined") return true;
    return document.visibilityState === "visible" && document.hasFocus();
  }
}
