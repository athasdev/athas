// Editor layout constants
export const EDITOR_CONSTANTS = {
  // Line height calculation
  LINE_HEIGHT_MULTIPLIER: 1.4,

  // Character width calculation (monospace approximation)
  CHAR_WIDTH_MULTIPLIER: 0.6,

  // Viewport
  DEFAULT_VIEWPORT_HEIGHT: 600,
  VIEWPORT_OVERSCAN_RATIO: 0.15, // Reduced for better performance
  MIN_OVERSCAN_LINES: 2, // Reduced minimum overscan
  MAX_OVERSCAN_LINES: 20, // Prevent excessive overscan

  // Gutter
  MIN_GUTTER_WIDTH: 40,
  GUTTER_CHAR_WIDTH: 8,
  GUTTER_PADDING: 24, // Increased to account for git indicators (8px left + 8px right + 8px spacing)
  GIT_INDICATOR_WIDTH: 8, // Space reserved for git gutter indicators on the left

  // Z-index layers
  Z_INDEX: {
    BASE: 0,
    DECORATION: 10,
    SELECTION: 20,
    OVERLAY: 30,
    DROPDOWN: 50,
    TOOLTIP: 50,
  },

  // Textarea
  HIDDEN_TEXTAREA_POSITION: -9999,

  // Dropdowns
  DROPDOWN_MIN_WIDTH: 200,
  DROPDOWN_MAX_WIDTH: 400,
  BREADCRUMB_DROPDOWN_MAX_HEIGHT: 300,
} as const;
