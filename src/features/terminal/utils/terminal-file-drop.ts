import { parseDroppedPaths } from "@/features/file-system/utils/file-system-dropped-paths";

function quoteTerminalPath(path: string): string {
  // Strip line breaks first: a pasted CR submits the line even inside
  // quotes, so no filename may contribute control characters.
  const sanitized = path.replace(/[\r\n]/g, "");
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(sanitized)) return sanitized;
  return `'${sanitized.replace(/'/g, "'\\''")}'`;
}

export function formatDroppedPathsForTerminal(rawPaths: string[]): string {
  const paths = parseDroppedPaths(rawPaths).filter((path) => !/[\r\n]/.test(path));
  if (paths.length === 0) return "";
  return `${paths.map(quoteTerminalPath).join(" ")} `;
}
