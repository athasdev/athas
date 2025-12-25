// Editor layout constants
export const EDITOR_CONSTANTS = {
  // Line height calculation
  LINE_HEIGHT_MULTIPLIER: 1.4,
  DEFAULT_LINE_HEIGHT: 20,

  // Character width calculation (monospace approximation)
  CHAR_WIDTH_MULTIPLIER: 0.6,

  // Viewport
  DEFAULT_VIEWPORT_HEIGHT: 600,
  VIEWPORT_OVERSCAN_RATIO: 0.75, // Increased for even smoother scrolling
  MIN_OVERSCAN_LINES: 10, // Increased minimum overscan
  VIEWPORT_BUFFER_LINES: 50, // Extra lines to tokenize above/below viewport
  SCROLL_UPDATE_THROTTLE: 100, // ms - throttle viewport updates during scroll
  SIGNIFICANT_LINE_DIFF: 10, // Lines - threshold for significant range change
  VIEWPORT_OVERLAP_THRESHOLD: 50, // Percentage - consider significant if overlap is more than 50%

  // Editor padding (must match CSS variables in overlay-editor.css)
  EDITOR_PADDING_TOP: 8,
  EDITOR_PADDING_LEFT: 16,
  EDITOR_PADDING_BOTTOM: 8,
  EDITOR_PADDING_RIGHT: 16,

  // Gutter
  MIN_GUTTER_WIDTH: 40,
  GUTTER_CHAR_WIDTH: 8,
  GUTTER_PADDING: 8, // Vertical padding for gutter elements (matches EDITOR_PADDING_TOP)
  GIT_INDICATOR_WIDTH: 8, // Space reserved for git gutter indicators on the left
  GUTTER_MARGIN: 8, // mr-2 in Tailwind (0.5rem = 8px) - margin between gutter and content
  FIXED_GUTTER_DIGITS: 4, // Reserve space for up to 4-digit line numbers (1-9999)

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

  // Context Menu
  CONTEXT_MENU_EDGE_MARGIN: 10,

  // Performance & Caching
  SMALL_FILE_THRESHOLD: 500, // Lines - always tokenize fully for small files
  UNIFIED_DEBOUNCE_MS: 100, // Single debounce for all updates
  COMPLETION_DEBOUNCE_MS: 0,
  COMPLETION_CACHE_TTL_MS: 5000,
  MAX_COMPLETION_CACHE_SIZE: 100,
  MAX_POSITION_CACHE_SIZE: 50,

  // Hover Tooltip
  HOVER_TOOLTIP_DELAY: 300,
  HOVER_TOOLTIP_HEIGHT: 200,
  HOVER_TOOLTIP_MARGIN: 10,

  // Dynamic Typing Speed
  INITIAL_TYPING_SPEED: 500,
  FAST_TYPING_THRESHOLD: 100,
  SLOW_TYPING_THRESHOLD: 500,
  MIN_TYPING_SPEED: 300,
  MAX_TYPING_SPEED: 800,
  TYPING_SPEED_ADJUSTMENT: 50,

  // Buffer Management
  MAX_OPEN_TABS: 10,
  MAX_CLOSED_BUFFERS_HISTORY: 10,

  // Precision
  WIDTH_PRECISION_MULTIPLIER: 100, // For rounding width calculations
} as const;
