export type BuiltInCommandPaletteViewId =
  | "root"
  | "quick-question"
  | "color-theme"
  | "icon-theme"
  | "local-history"
  | "outline";

export type ExtensionCommandPaletteViewId = `extension:${string}`;

export type CommandPaletteViewId = BuiltInCommandPaletteViewId | ExtensionCommandPaletteViewId;
