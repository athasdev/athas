import { getCurrentWindow } from "@tauri-apps/api/window";
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
