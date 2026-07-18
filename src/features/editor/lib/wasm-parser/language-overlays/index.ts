import type { HighlightToken } from "../../../types/wasm-parser/wasm-parser.types";
import {
  ANGULAR_TEMPLATE_LANGUAGE_ID,
  angularTemplateTokens,
  isAngularTemplatePath,
} from "./angular-template";
import { rmarkdownTokens } from "./rmarkdown";

export { ANGULAR_TEMPLATE_LANGUAGE_ID, isAngularTemplatePath };

export function getLanguageOverlayTokens(languageId: string, content: string): HighlightToken[] {
  if (languageId === ANGULAR_TEMPLATE_LANGUAGE_ID) {
    return angularTemplateTokens(content);
  }

  if (languageId === "rmarkdown") {
    return rmarkdownTokens(content);
  }

  return [];
}
