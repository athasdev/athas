type BuiltInCommandPaletteViewId =
  | "root"
  | "quick-question"
  | "color-theme"
  | "icon-theme"
  | "local-history"
  | "outline"
  | "databases";

type ExtensionCommandPaletteViewId = `extension:${string}`;

export type CommandPaletteViewId = BuiltInCommandPaletteViewId | ExtensionCommandPaletteViewId;
