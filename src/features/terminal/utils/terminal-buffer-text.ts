import type { IBuffer } from "@xterm/xterm";

type TerminalBufferSource = Pick<IBuffer, "length" | "getLine">;
type TerminalBuffers = {
  active: Pick<IBuffer, "type">;
  normal: TerminalBufferSource;
  alternate: TerminalBufferSource;
};

export const ALTERNATE_SCREEN_SEPARATOR = "----- Full-screen program -----";

/**
 * Reads a terminal buffer as plain text: soft-wrapped rows are joined back into one line,
 * trailing whitespace on each line and trailing blank lines are dropped.
 */
export function getTerminalBufferText(buffer: TerminalBufferSource): string {
  const lines: string[] = [];
  for (let row = 0; row < buffer.length; row += 1) {
    const line = buffer.getLine(row);
    if (!line) break;
    const continuesOnNextRow = buffer.getLine(row + 1)?.isWrapped ?? false;
    const text = line.translateToString(!continuesOnNextRow);
    if (line.isWrapped && lines.length > 0) {
      lines[lines.length - 1] += text;
    } else {
      lines.push(text);
    }
  }

  const trimmed = lines.map((line) => line.trimEnd());
  while (trimmed.length > 0 && trimmed[trimmed.length - 1] === "") trimmed.pop();
  return trimmed.join("\n");
}

/**
 * The text a terminal export saves: the shell's scrollback (the normal buffer), followed by the
 * screen of a full-screen program such as vim or less when one is running in the alternate buffer.
 */
export function getTerminalExportText(buffers: TerminalBuffers): string {
  const normal = getTerminalBufferText(buffers.normal);
  if (buffers.active.type !== "alternate") return normal;
  const alternate = getTerminalBufferText(buffers.alternate);
  if (!alternate) return normal;
  return [normal, ALTERNATE_SCREEN_SEPARATOR, alternate].filter(Boolean).join("\n");
}

export function getTerminalExportFileName(terminalName: string, date = new Date()): string {
  const safeName = terminalName.replace(/[^a-zA-Z0-9]/g, "_") || "terminal";
  return `${safeName}_${date.toISOString().split("T")[0]}.txt`;
}
