export type BuiltInCommandPaletteViewId =
  | "root"
  | "quick-question"
  | "color-theme"
  | "icon-theme"
  | "local-history"
  | "outline"
  | "databases";

export type ExtensionCommandPaletteViewId = `extension:${string}`;

export type CommandPaletteViewId = BuiltInCommandPaletteViewId | ExtensionCommandPaletteViewId;
