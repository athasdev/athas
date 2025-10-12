import { classicIconTheme } from "./builtin/classic-theme";
import { colorfulMaterialIconTheme } from "./builtin/colorful-material-theme";
import { compactIconTheme } from "./builtin/compact-theme";
import { materialIconTheme } from "./builtin/material-theme";
import { minimalIconTheme } from "./builtin/minimal-theme";
import { noneIconTheme } from "./builtin/none-theme";
import { setiIconTheme } from "./builtin/seti-theme";
import { iconThemeRegistry } from "./icon-theme-registry";

export function initializeIconThemes() {
  // Register built-in icon themes
  iconThemeRegistry.registerTheme(materialIconTheme);
  iconThemeRegistry.registerTheme(colorfulMaterialIconTheme);
  iconThemeRegistry.registerTheme(minimalIconTheme);
  iconThemeRegistry.registerTheme(noneIconTheme);
  iconThemeRegistry.registerTheme(setiIconTheme);
  iconThemeRegistry.registerTheme(compactIconTheme);
  iconThemeRegistry.registerTheme(classicIconTheme);
}
