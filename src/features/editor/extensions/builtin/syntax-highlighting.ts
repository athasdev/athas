import { logger } from "../../utils/logger";

const SYNTAX_HIGHLIGHTING_REFRESH_EVENT = "syntax-highlighting-refresh";

export async function setSyntaxHighlightingFilePath(filePath: string) {
  logger.debug("SyntaxHighlighter", "Requesting syntax highlighting refresh for", filePath);

  if (typeof window === "undefined") return;

  window.dispatchEvent(
    new CustomEvent(SYNTAX_HIGHLIGHTING_REFRESH_EVENT, {
      detail: { filePath },
    }),
  );
}
