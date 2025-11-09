/**
 * Layout hook stub for backward compatibility
 */

import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";

export function useLayout() {
  return {
    gutterWidth: 60,
    charWidth: 8.4,
    lineHeight: EDITOR_CONSTANTS.DEFAULT_LINE_HEIGHT,
  };
}

export function useEditorLayout() {
  return {
    gutterWidth: 60,
    charWidth: 8.4,
    lineHeight: EDITOR_CONSTANTS.DEFAULT_LINE_HEIGHT,
  };
}
