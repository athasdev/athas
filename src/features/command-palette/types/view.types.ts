type BuiltInCommandPaletteViewId =
  | "root"
  | "color-theme"
  | "icon-theme"
  | "local-history"
  | "outline";

type ExtensionCommandPaletteViewId = `extension:${string}`;

export type CommandPaletteViewId = BuiltInCommandPaletteViewId | ExtensionCommandPaletteViewId;
