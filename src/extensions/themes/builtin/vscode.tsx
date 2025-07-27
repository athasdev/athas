import { Moon, Sun } from "lucide-react";
import { BaseThemeExtension } from "../base-theme-extension";
import type { ThemeDefinition } from "../types";

class VSCodeExtension extends BaseThemeExtension {
  readonly name = "VS Code";
  readonly version = "1.0.0";
  readonly description = "VS Code theme variants - themes inspired by Visual Studio Code";

  readonly themes: ThemeDefinition[] = [
    {
      id: "vs-code-light",
      name: "VS Code Light",
      description: "Light theme inspired by Visual Studio Code",
      category: "Light",
      icon: <Sun size={14} />,
      isDark: false,
      cssVariables: {
        "--tw-primary-bg": "#ffffff",
        "--tw-secondary-bg": "#f3f3f3",
        "--tw-text": "#333333",
        "--tw-text-light": "#6a6a6a",
        "--tw-text-lighter": "#999999",
        "--tw-border": "#e5e5e5",
        "--tw-hover": "#f0f0f0",
        "--tw-selected": "#e8e8e8",
        "--tw-accent": "#007acc",
      },
      syntaxTokens: {
        "--color-syntax-keyword": "#0000ff",
        "--color-syntax-string": "#a31515",
        "--color-syntax-number": "#098658",
        "--color-syntax-comment": "#008000",
        "--color-syntax-variable": "#001080",
        "--color-syntax-function": "#795e26",
        "--color-syntax-constant": "#0070c1",
        "--color-syntax-property": "#001080",
        "--color-syntax-type": "#267f99",
        "--color-syntax-operator": "#000000",
        "--color-syntax-punctuation": "#000000",
        "--color-syntax-boolean": "#0000ff",
        "--color-syntax-null": "#0000ff",
        "--color-syntax-regex": "#811f3f",
        "--color-syntax-jsx": "#800000",
        "--color-syntax-jsx-attribute": "#ff0000",
      },
    },
    {
      id: "vs-code-dark",
      name: "VS Code Dark",
      description: "Dark theme inspired by Visual Studio Code",
      category: "Dark",
      icon: <Moon size={14} />,
      isDark: true,
      cssVariables: {
        "--tw-primary-bg": "#1e1e1e",
        "--tw-secondary-bg": "#252526",
        "--tw-text": "#cccccc",
        "--tw-text-light": "#969696",
        "--tw-text-lighter": "#6a6a6a",
        "--tw-border": "#3e3e42",
        "--tw-hover": "#2d2d30",
        "--tw-selected": "#3e3e42",
        "--tw-accent": "#007acc",
      },
      syntaxTokens: {
        "--color-syntax-keyword": "#569cd6",
        "--color-syntax-string": "#ce9178",
        "--color-syntax-number": "#b5cea8",
        "--color-syntax-comment": "#6a9955",
        "--color-syntax-variable": "#9cdcfe",
        "--color-syntax-function": "#dcdcaa",
        "--color-syntax-constant": "#4fc1ff",
        "--color-syntax-property": "#9cdcfe",
        "--color-syntax-type": "#4ec9b0",
        "--color-syntax-operator": "#d4d4d4",
        "--color-syntax-punctuation": "#d4d4d4",
        "--color-syntax-boolean": "#569cd6",
        "--color-syntax-null": "#569cd6",
        "--color-syntax-regex": "#d16969",
        "--color-syntax-jsx": "#569cd6",
        "--color-syntax-jsx-attribute": "#92c5f8",
      },
    },
  ];
}

export const vscodeExtension = new VSCodeExtension();