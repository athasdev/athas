import { logger } from "../../utils/logger";

export async function setSyntaxHighlightingFilePath(filePath: string) {
  logger.debug("SyntaxHighlighter", "Requesting syntax highlighting refresh for", filePath);
}
