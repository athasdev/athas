import { useCallback } from "react";

export interface TerminalTheme {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  selectionForeground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

// Default dark theme colors - guaranteed to work
const DEFAULT_THEME: TerminalTheme = {
  background: "#1a1a1a",
  foreground: "#e5e5e5",
  cursor: "#3b82f6",
  cursorAccent: "#1a1a1a",
  selectionBackground: "#3b82f640",
  selectionForeground: "#e5e5e5",
  black: "#1a1a1a",
  red: "#ff7b72",
  green: "#7ee787",
  yellow: "#ffa657",
  blue: "#79c0ff",
  magenta: "#d2a8ff",
  cyan: "#a5d6ff",
  white: "#b3b3b3",
  brightBlack: "#8b949e",
  brightRed: "#f87171",
  brightGreen: "#86efac",
  brightYellow: "#fbbf24",
  brightBlue: "#60a5fa",
  brightMagenta: "#c084fc",
  brightCyan: "#67e8f9",
  brightWhite: "#e5e5e5",
};

// Check if a value is a valid hex color
function isValidColor(value: string): boolean {
  return /^#[0-9A-Fa-f]{3,8}$/.test(value);
}

export function useTerminalTheme() {
  const getTerminalTheme = useCallback((): TerminalTheme => {
    const computedStyle = getComputedStyle(document.documentElement);

    // Helper to get a valid color from CSS variables or use default
    const getColor = (varNames: string[], defaultValue: string): string => {
      for (const varName of varNames) {
        const value = computedStyle.getPropertyValue(varName).trim();
        if (value && isValidColor(value)) {
          return value;
        }
      }
      return defaultValue;
    };

    const bg = getColor(["--primary-bg", "--color-primary-bg"], DEFAULT_THEME.background);
    const fg = getColor(["--text", "--color-text"], DEFAULT_THEME.foreground);
    const accent = getColor(["--accent", "--color-accent"], DEFAULT_THEME.cursor);

    return {
      background: bg,
      foreground: fg,
      cursor: accent,
      cursorAccent: bg,
      selectionBackground: `${accent}40`,
      selectionForeground: fg,
      black: getColor(["--terminal-black", "--color-terminal-black"], DEFAULT_THEME.black),
      red: getColor(["--terminal-red", "--color-terminal-red"], DEFAULT_THEME.red),
      green: getColor(["--terminal-green", "--color-terminal-green"], DEFAULT_THEME.green),
      yellow: getColor(["--terminal-yellow", "--color-terminal-yellow"], DEFAULT_THEME.yellow),
      blue: getColor(["--terminal-blue", "--color-terminal-blue"], DEFAULT_THEME.blue),
      magenta: getColor(["--terminal-magenta", "--color-terminal-magenta"], DEFAULT_THEME.magenta),
      cyan: getColor(["--terminal-cyan", "--color-terminal-cyan"], DEFAULT_THEME.cyan),
      white: getColor(["--terminal-white", "--color-terminal-white"], DEFAULT_THEME.white),
      brightBlack: getColor(
        ["--terminal-bright-black", "--color-terminal-bright-black"],
        DEFAULT_THEME.brightBlack,
      ),
      brightRed: getColor(
        ["--terminal-bright-red", "--color-terminal-bright-red"],
        DEFAULT_THEME.brightRed,
      ),
      brightGreen: getColor(
        ["--terminal-bright-green", "--color-terminal-bright-green"],
        DEFAULT_THEME.brightGreen,
      ),
      brightYellow: getColor(
        ["--terminal-bright-yellow", "--color-terminal-bright-yellow"],
        DEFAULT_THEME.brightYellow,
      ),
      brightBlue: getColor(
        ["--terminal-bright-blue", "--color-terminal-bright-blue"],
        DEFAULT_THEME.brightBlue,
      ),
      brightMagenta: getColor(
        ["--terminal-bright-magenta", "--color-terminal-bright-magenta"],
        DEFAULT_THEME.brightMagenta,
      ),
      brightCyan: getColor(
        ["--terminal-bright-cyan", "--color-terminal-bright-cyan"],
        DEFAULT_THEME.brightCyan,
      ),
      brightWhite: getColor(
        ["--terminal-bright-white", "--color-terminal-bright-white"],
        DEFAULT_THEME.brightWhite,
      ),
    };
  }, []);

  return { getTerminalTheme };
}
