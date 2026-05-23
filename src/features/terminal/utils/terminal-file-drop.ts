import { parseDroppedPaths } from "@/features/file-system/utils/file-system-dropped-paths";

function quoteTerminalPath(path: string): string {
  const escaped = path.replace(/(["\\$`])/g, "\\$1");
  return /[\s"'\\$`]/.test(path) ? `"${escaped}"` : escaped;
}

export function formatDroppedPathsForTerminal(rawPaths: string[]): string {
  const paths = parseDroppedPaths(rawPaths);
  if (paths.length === 0) return "";
  return `${paths.map(quoteTerminalPath).join(" ")} `;
}
