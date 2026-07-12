import { enableMapSet } from "immer";
import { initializeIconThemes } from "@/extensions/icon-themes/icon-theme-initializer";
import { initializeKeymaps } from "@/features/keymaps/services/keymaps-init";

export function runSynchronousBootstrapSteps() {
  enableMapSet();
  initializeIconThemes();
  initializeKeymaps();
}
