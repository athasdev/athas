import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useTerminalStore } from "@/features/terminal/stores/terminal-store";
import { useProjectStore } from "@/features/window/stores/project-store";

export interface AcpTerminalOutput {
  terminalId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

export function getAcpTerminalOutputs(output: unknown): AcpTerminalOutput[] {
  if (!Array.isArray(output)) return [];

  return output
    .filter(isRecord)
    .filter((item) => item.type === "terminal" && typeof item.terminalId === "string")
    .map((item) => ({
      terminalId: item.terminalId as string,
    }));
}

export function openAcpTerminalOutput(output: unknown): string | null {
  const terminal = getAcpTerminalOutputs(output)[0];
  if (!terminal) return null;

  const name = "ACP Terminal";
  const currentDirectory = useProjectStore.getState().rootFolderPath ?? "";

  useTerminalStore.getState().updateSession(terminal.terminalId, {
    id: terminal.terminalId,
    name,
    currentDirectory,
    connectionId: terminal.terminalId,
    createdAt: new Date(),
  });

  return useBufferStore.getState().actions.openTerminalBuffer({
    sessionId: terminal.terminalId,
    name,
    workingDirectory: currentDirectory || undefined,
  });
}
