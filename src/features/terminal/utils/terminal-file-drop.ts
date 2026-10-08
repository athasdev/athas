import type { Platform } from "@tauri-apps/plugin-os";
import { parseDroppedPaths } from "@/features/file-system/services/file-system-dropped-paths";

type TerminalQuoteStyle = "posix" | "powershell" | "cmd";

export function getTerminalQuoteStyle(
  shellId: string | undefined,
  platform: Platform,
  isRemote = false,
): TerminalQuoteStyle {
  if (isRemote || platform !== "windows") return "posix";

  const id = shellId?.trim().toLowerCase() ?? "";
  if (id === "powershell" || id === "pwsh") return "powershell";
  if (id === "bash" || id === "nu" || id === "wsl" || id.startsWith("wsl:")) return "posix";
  // cmd.exe is the Windows default when no shell is selected.
  return "cmd";
}

function quoteTerminalPath(path: string, style: TerminalQuoteStyle): string {
  switch (style) {
    case "cmd":
      // Windows file names cannot contain double quotes, and cmd treats
      // & | < > ^ literally inside them.
      if (/^[A-Za-z0-9_.:\\/-]+$/.test(path)) return path;
      return `"${path.replace(/"/g, "")}"`;
    case "powershell":
      // PowerShell single-quoted strings are literal; a quote is escaped by
      // doubling it, and the typographic single quotes count as quotes too.
      if (/^[A-Za-z0-9_.:\\/-]+$/.test(path)) return path;
      return `'${path.replace(/['\u2018\u2019\u201A\u201B]/g, "$&$&")}'`;
    case "posix":
      if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(path)) return path;
      return `'${path.replace(/'/g, "'\\''")}'`;
  }
}

export function formatDroppedPathsForTerminal(
  rawPaths: string[],
  style: TerminalQuoteStyle = "posix",
): string {
  // A pasted line break submits the prompt even inside quotes, so paths
  // carrying one are never inserted.
  const paths = parseDroppedPaths(rawPaths).filter((path) => !/[\r\n]/.test(path));
  if (paths.length === 0) return "";
  return `${paths.map((path) => quoteTerminalPath(path, style)).join(" ")} `;
}
