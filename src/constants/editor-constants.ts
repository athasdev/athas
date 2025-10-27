// Editor layout constants
export const EDITOR_CONSTANTS = {
  // Line height calculation
  LINE_HEIGHT_MULTIPLIER: 1.4,

  // Character width calculation (monospace approximation)
  CHAR_WIDTH_MULTIPLIER: 0.6,

  // Viewport
  DEFAULT_VIEWPORT_HEIGHT: 600,
  VIEWPORT_OVERSCAN_RATIO: 0.75, // Increased for even smoother scrolling
  MIN_OVERSCAN_LINES: 10, // Increased minimum overscan

  // Gutter
  MIN_GUTTER_WIDTH: 40,
  GUTTER_CHAR_WIDTH: 8,
  GUTTER_PADDING: 24, // Increased to account for git indicators (8px left + 8px right + 8px spacing)
  GIT_INDICATOR_WIDTH: 8, // Space reserved for git gutter indicators on the left
  GUTTER_MARGIN: 8, // mr-2 in Tailwind (0.5rem = 8px) - margin between gutter and content

  // Z-index layers - ordered by priority (lowest to highest)
  Z_INDEX: {
    BASE: 0,
    DECORATION: 10,
    SELECTION: 20,
    CURSOR: 25,
    GIT_BLAME: 30, // Inline git blame (lowest priority overlay)
    OVERLAY: 40,
    DROPDOWN: 100, // Generic dropdowns (breadcrumb, file mention, etc.)
    COMPLETION: 100, // LSP completions
    INLINE_TOOLBAR: 200, // Inline edit toolbar
    TOOLTIP: 250, // Hover tooltips
    HOVER_TOOLTIP: 250, // Hover tooltips (alias)
    CONTEXT_MENU: 300, // Context menu (highest priority)
  },

  // Textarea
  HIDDEN_TEXTAREA_POSITION: -9999,

  // Dropdowns
  DROPDOWN_MIN_WIDTH: 200,
  DROPDOWN_MAX_WIDTH: 400,
  BREADCRUMB_DROPDOWN_MAX_HEIGHT: 300,
} as const;
