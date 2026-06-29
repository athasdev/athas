import type { IconThemeDefinition } from "./types";

export function isLegacyAthasIconTheme(theme: IconThemeDefinition) {
  return (
    theme.id === "athas-icons-dimmed" ||
    theme.id === "athas-icons-light" ||
    theme.id === "athas-file-icons" ||
    theme.id === "athas-file-icons-dark" ||
    theme.id === "athas-file-icons-light" ||
    theme.name === "Athas (Dark)" ||
    theme.name === "Athas (Dimmed)" ||
    theme.name === "Athas (Light)" ||
    theme.name === "Athas File Icons"
  );
}

export function getVisibleIconThemes(themes: IconThemeDefinition[]) {
  return themes.filter((theme) => !isLegacyAthasIconTheme(theme));
}
