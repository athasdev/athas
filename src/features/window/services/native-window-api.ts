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
