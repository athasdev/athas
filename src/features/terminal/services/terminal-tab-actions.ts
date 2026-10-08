import { saveTextFileWithDialog } from "@/utils/file-dialogs";
import { showToast } from "@/utils/toast";
import { getTerminalBufferText, getTerminalExportFileName } from "../utils/terminal-buffer-text";
import { getTerminalEmulator } from "./terminal-emulator-registry";

export function clearTerminal(sessionId: string): boolean {
  const emulator = getTerminalEmulator(sessionId);
  if (!emulator) return false;
  emulator.clear();
  return true;
}

export async function exportTerminalOutput(
  sessionId: string,
  terminalName: string,
): Promise<string | null> {
  const emulator = getTerminalEmulator(sessionId);
  const content = emulator ? getTerminalBufferText(emulator.terminal.buffer.active) : "";
  if (!content) {
    showToast({ key: "terminal-export", type: "info", message: "No terminal output to export" });
    return null;
  }

  try {
    const filePath = await saveTextFileWithDialog(
      {
        defaultPath: getTerminalExportFileName(terminalName),
        filters: [
          { name: "Text Files", extensions: ["txt"] },
          { name: "All Files", extensions: ["*"] },
        ],
      },
      () => content,
    );
    if (filePath) {
      showToast({
        key: "terminal-export",
        type: "success",
        message: "Terminal output exported",
        description: filePath,
      });
    }
    return filePath;
  } catch (error) {
    showToast({
      key: "terminal-export",
      type: "error",
      message: "Failed to export terminal output",
      description: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
