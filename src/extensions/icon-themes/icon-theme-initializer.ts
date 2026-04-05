import { colorfulMaterialIconTheme } from "./builtin/colorful-material-theme";
import { iconThemeRegistry } from "./icon-theme-registry";

export function initializeIconThemes() {
  iconThemeRegistry.registerTheme(colorfulMaterialIconTheme);
}
