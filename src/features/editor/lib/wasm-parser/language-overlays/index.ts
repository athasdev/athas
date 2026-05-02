import type { HighlightToken } from "../types";
import {
  ANGULAR_TEMPLATE_LANGUAGE_ID,
  angularTemplateTokens,
  isAngularTemplatePath,
} from "./angular-template";

export { ANGULAR_TEMPLATE_LANGUAGE_ID, isAngularTemplatePath };

export function getLanguageOverlayTokens(languageId: string, content: string): HighlightToken[] {
  if (languageId === ANGULAR_TEMPLATE_LANGUAGE_ID) {
    return angularTemplateTokens(content);
  }

  return [];
}
