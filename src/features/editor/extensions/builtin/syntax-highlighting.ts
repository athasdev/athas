import { logger } from "../../utils/logger";
import type { EditorAPI, EditorExtension } from "../types";

export const SYNTAX_HIGHLIGHTING_REFRESH_EVENT = "syntax-highlighting-refresh";

export const syntaxHighlightingExtension: EditorExtension = {
  name: "Syntax Highlighting",
  version: "1.0.0",
  description: "Requests syntax highlighting refreshes for the worker tokenizer",

  initialize: (_editor: EditorAPI) => {},
  dispose: () => {},
  decorations: () => [],
};

export async function setSyntaxHighlightingFilePath(filePath: string) {
  logger.debug("SyntaxHighlighter", "Requesting syntax highlighting refresh for", filePath);

  if (typeof window === "undefined") return;

  window.dispatchEvent(
    new CustomEvent(SYNTAX_HIGHLIGHTING_REFRESH_EVENT, {
      detail: { filePath },
    }),
  );
}
