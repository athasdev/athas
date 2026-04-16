import { enableMapSet } from "immer";
import { initializeIconThemes } from "@/extensions/icon-themes/icon-theme-initializer";
import { initializeKeymaps } from "@/features/keymaps/init";
import { ensureStartupAppearanceApplied } from "@/features/settings/lib/appearance-bootstrap";

export function runSynchronousBootstrapSteps() {
  ensureStartupAppearanceApplied();
  enableMapSet();
  initializeIconThemes();
  initializeKeymaps();
}
