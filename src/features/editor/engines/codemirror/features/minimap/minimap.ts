import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { showMinimap } from "@replit/codemirror-minimap";

/**
 * The minimap's chrome in the theme's colors. The slider uses the shared scrollbar thumb colors and
 * shows on hover, like Monaco's minimap; the text itself takes the editor's highlight colors.
 */
const minimapTheme = EditorView.theme({
  ".cm-minimap-gutter.cm-gutters": {
    backgroundColor: "var(--background)",
    borderLeft: "none",
  },
  ".cm-minimap-gutter .cm-minimap-inner .cm-minimap-overlay-container .cm-minimap-overlay": {
    background: "var(--app-scrollbar-thumb-subtle)",
    opacity: "1",
  },
  ".cm-minimap-gutter .cm-minimap-inner .cm-minimap-overlay-container .cm-minimap-overlay:hover": {
    background: "var(--app-scrollbar-thumb)",
    opacity: "1",
  },
  ".cm-minimap-gutter .cm-minimap-inner .cm-minimap-overlay-container.cm-minimap-overlay-active .cm-minimap-overlay":
    {
      background: "var(--app-scrollbar-thumb-active)",
      opacity: "1",
    },
  ".cm-minimap-gutter .cm-minimap-inner .cm-minimap-box-shadow": { boxShadow: "none" },
});

/** A minimap of the document on the right edge of the editor. */
export const minimap: Extension = [
  showMinimap.of({
    create: () => ({ dom: document.createElement("div") }),
    displayText: "characters",
    showOverlay: "mouse-over",
  }),
  minimapTheme,
];
