import { reactCompilerPreset } from "@vitejs/plugin-react";

export function createReactCompilerPreset() {
  const preset = reactCompilerPreset();

  return {
    ...preset,
    rolldown: {
      ...preset.rolldown,
      filter: {
        ...preset.rolldown.filter,
        // Generated Zustand selectors hide hooks behind store.use.property().
        // Compiling these modules can memoize the call and skip hooks on rerender.
        code: { exclude: /(?:\.\s*use\b|\[\s*["']use["']\s*\])/ },
      },
    },
  };
}
