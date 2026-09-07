import type { Terminal } from "@/features/terminal/types/terminal.types";
import { normalizeTerminalTitle } from "@/features/terminal/utils/terminal-title";

type TerminalSessionState = Pick<Partial<Terminal>, "title" | "currentDirectory"> | undefined;

function getDirectoryLabel(directory?: string) {
  if (!directory) return "";
  const normalized = directory.replace(/[\\/]+$/, "");
  return normalized.split(/[\\/]/).pop() || directory;
}

function getCommandLabel(command?: string) {
  if (!command) return "";
  const firstSegment = command.trim().split(/\s+/)[0];
  return firstSegment?.split(/[\\/]/).pop() || "";
}

function isUsefulTerminalTitle(title?: string) {
  if (!title) return false;
  if (title === "Default Terminal") return false;
  if (title.length > 28) return false;
  if (title.includes("@")) return false;
  if (title.includes("/") || title.includes("\\")) return false;
  return true;
}

export function getTerminalDisplayName(terminal: Terminal, session?: TerminalSessionState) {
  if (terminal.customName && terminal.name.trim()) return terminal.name;

  const title = normalizeTerminalTitle(session?.title ?? "");
  if (title && isUsefulTerminalTitle(title)) return title;
  const commandLabel = getCommandLabel(terminal.initialCommand);
  if (commandLabel) return commandLabel;
  const dirLabel = getDirectoryLabel(session?.currentDirectory || terminal.currentDirectory);
  if (dirLabel) return dirLabel;
  return terminal.name;
}
