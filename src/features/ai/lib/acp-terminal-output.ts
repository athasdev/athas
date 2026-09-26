import type { AcpTerminalExit, AcpTerminalSnapshot } from "@/features/ai/types/acp.types";
import type { Message, ToolCall } from "@/features/ai/types/ai-chat.types";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useTerminalStore } from "@/features/terminal/stores/terminal.store";
import { useProjectStore } from "@/features/window/stores/project.store";

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

  useTerminalStore.getState().actions.updateSession(terminal.terminalId, {
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

/** How much of a terminal's output the chat keeps; older output is dropped first. */
export const ACP_TERMINAL_DISPLAY_LIMIT = 200_000;

export function appendAcpTerminalOutput<T extends AcpTerminalSnapshot>(
  snapshot: T,
  data: string,
  limit = ACP_TERMINAL_DISPLAY_LIMIT,
): T {
  const output = snapshot.output + data;
  if (output.length <= limit) return { ...snapshot, output };
  return { ...snapshot, output: output.slice(output.length - limit), truncated: true };
}

/**
 * Keeps `snapshot` as what terminal `terminalId` showed on the latest tool call that displays
 * it, so the output stays with the call after the terminal is released. Returns the message's
 * updated calls, or null when no call shows that terminal.
 */
export function withAcpTerminalSnapshot(
  messages: readonly Message[],
  terminalId: string,
  snapshot: AcpTerminalSnapshot,
): { messageId: string; toolCalls: ToolCall[] } | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    const toolCalls = message.toolCalls;
    const target = toolCalls?.findIndex((toolCall) =>
      getAcpTerminalOutputs(toolCall.output).some((item) => item.terminalId === terminalId),
    );
    if (!toolCalls || target === undefined || target < 0) continue;
    return {
      messageId: message.id,
      toolCalls: toolCalls.map((toolCall, callIndex) =>
        callIndex === target
          ? { ...toolCall, terminals: { ...toolCall.terminals, [terminalId]: snapshot } }
          : toolCall,
      ),
    };
  }
  return null;
}

const ESCAPE = String.fromCharCode(27);
const BELL = String.fromCharCode(7);
// OSC sequences (titles, links) end with BEL or ESC \; CSI sequences carry colors and cursor moves.
const OSC_PATTERN = new RegExp(`${ESCAPE}\\][^${BELL}${ESCAPE}]*(?:${BELL}|${ESCAPE}\\\\)`, "g");
const CSI_PATTERN = new RegExp(`${ESCAPE}\\[[0-?]*[ -/]*[@-~]`, "g");
const OTHER_ESCAPE_PATTERN = new RegExp(`${ESCAPE}[@-Z\\\\-_]`, "g");

/**
 * Terminal output as plain text for the chat: escape sequences are dropped, and a line
 * rewritten with carriage returns (progress bars) keeps only what it ended as.
 */
export function formatAcpTerminalText(output: string): string {
  return output
    .replace(OSC_PATTERN, "")
    .replace(CSI_PATTERN, "")
    .replace(OTHER_ESCAPE_PATTERN, "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => {
      const parts = line.split("\r").filter((part) => part.length > 0);
      return parts[parts.length - 1] ?? "";
    })
    .join("\n");
}

/** A short line saying how a terminal's command ended; null while it runs. */
export function describeAcpTerminalExit(exit: AcpTerminalExit | null): string | null {
  if (!exit) return null;
  if (exit.signal === "released") return "Stopped when the agent released the terminal";
  if (exit.signal === "pty_error") return "The terminal failed";
  if (exit.signal) return `Ended by signal ${exit.signal}`;
  if (exit.exitCode !== null) return `Exited with code ${exit.exitCode}`;
  return "Exited";
}
