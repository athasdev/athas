/**
 * Shared width scale for anchored overlay surfaces (dropdown menus, popovers,
 * comboboxes). Every overlay in the app picks one of these presets through a
 * `size` prop instead of writing `w-*` / `min-w-*` into `className`.
 *
 * Adding a value here is a design-system decision. Prefer reusing a preset over
 * introducing a new one.
 */
export const OVERLAY_SIZES = {
  /** Short action submenus (rename, delete, copy). */
  compact: "w-44",
  /** Standard action menus. */
  default: "w-56",
  /** Lists of labelled rows, usually searchable. */
  wide: "w-72",
  /** Content-bearing surfaces (commit messages, value previews). */
  panel: "w-96",
  /** Matches the anchor/trigger width. */
  trigger: "w-(--anchor-width)",
  /** Content-sized. Only for overlays with genuinely unpredictable width. */
  auto: "",
} as const;

export type OverlaySize = keyof typeof OVERLAY_SIZES;

/**
 * The same scale expressed as a minimum width, for overlays whose width follows
 * their anchor (comboboxes) and only needs a floor.
 */
export const OVERLAY_MIN_SIZES = {
  compact: "min-w-44",
  default: "min-w-56",
  wide: "min-w-72",
  panel: "min-w-96",
  trigger: "",
  auto: "",
} as const satisfies Record<OverlaySize, string>;

/**
 * Viewport clamp applied to every overlay surface so a preset can never push
 * content off-screen on a narrow window.
 */
export const OVERLAY_MAX_WIDTH = "max-w-[min(480px,calc(100vw-16px))]";

/**
 * Height cap for scrolling overlays. Shared by the `list` and `searchable` menu
 * viewports so a long list scrolls at the same point everywhere.
 */
export const OVERLAY_MAX_HEIGHT = "max-h-80";
