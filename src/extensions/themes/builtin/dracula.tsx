import { Moon } from "lucide-react";
import { BaseThemeExtension } from "../base-theme-extension";
import type { ThemeDefinition } from "../types";

class DraculaExtension extends BaseThemeExtension {
  readonly name = "Dracula";
  readonly version = "1.0.0";
  readonly description = "Dracula theme variants - dark theme with vibrant colors";

  readonly themes: ThemeDefinition[] = [
    {
      id: "dracula",
      name: "Dracula",
      description: "Official Dracula theme with rich purples and vibrant accents",
      category: "Dark",
      icon: <Moon size={14} />,
      isDark: true,
      cssVariables: {
        "--tw-primary-bg": "#282a36",
        "--tw-secondary-bg": "#44475a",
        "--tw-text": "#f8f8f2",
        "--tw-text-light": "#f8f8f2",
        "--tw-text-lighter": "#6272a4",
        "--tw-border": "#44475a",
        "--tw-hover": "#44475a",
        "--tw-selected": "#6272a4",
        "--tw-accent": "#bd93f9",
      },
      syntaxTokens: {
        "--color-syntax-keyword": "#ff79c6",
        "--color-syntax-string": "#f1fa8c",
        "--color-syntax-number": "#bd93f9",
        "--color-syntax-comment": "#6272a4",
        "--color-syntax-variable": "#f8f8f2",
        "--color-syntax-function": "#50fa7b",
        "--color-syntax-constant": "#bd93f9",
        "--color-syntax-property": "#f8f8f2",
        "--color-syntax-type": "#8be9fd",
        "--color-syntax-operator": "#ff79c6",
        "--color-syntax-punctuation": "#f8f8f2",
        "--color-syntax-boolean": "#bd93f9",
        "--color-syntax-null": "#bd93f9",
        "--color-syntax-regex": "#f1fa8c",
        "--color-syntax-jsx": "#ff79c6",
        "--color-syntax-jsx-attribute": "#50fa7b",
      },
    },
    {
      id: "dracula-soft",
      name: "Dracula Soft",
      description: "Softer variant with reduced contrast",
      category: "Dark",
      icon: <Moon size={14} />,
      isDark: true,
      cssVariables: {
        "--tw-primary-bg": "#21222c",
        "--tw-secondary-bg": "#282a36",
        "--tw-text": "#f8f8f2",
        "--tw-text-light": "#e9e9e9",
        "--tw-text-lighter": "#6272a4",
        "--tw-border": "#44475a",
        "--tw-hover": "#3a3c4e",
        "--tw-selected": "#4d5066",
        "--tw-accent": "#bd93f9",
      },
      syntaxTokens: {
        "--color-syntax-keyword": "#ff79c6",
        "--color-syntax-string": "#f1fa8c",
        "--color-syntax-number": "#bd93f9",
        "--color-syntax-comment": "#6272a4",
        "--color-syntax-variable": "#f8f8f2",
        "--color-syntax-function": "#50fa7b",
        "--color-syntax-constant": "#bd93f9",
        "--color-syntax-property": "#f8f8f2",
        "--color-syntax-type": "#8be9fd",
        "--color-syntax-operator": "#ff79c6",
        "--color-syntax-punctuation": "#f8f8f2",
        "--color-syntax-boolean": "#bd93f9",
        "--color-syntax-null": "#bd93f9",
        "--color-syntax-regex": "#f1fa8c",
        "--color-syntax-jsx": "#ff79c6",
        "--color-syntax-jsx-attribute": "#50fa7b",
      },
    },
  ];
}

export const draculaExtension = new DraculaExtension();