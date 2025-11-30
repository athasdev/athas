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

export function useTerminalTheme() {
  const getTerminalTheme = useCallback((): TerminalTheme => {
    const computedStyle = getComputedStyle(document.documentElement);
    const getColor = (varName: string) => computedStyle.getPropertyValue(varName).trim();

    return {
      background: getColor("--color-primary-bg"),
      foreground: getColor("--color-text"),
      cursor: getColor("--color-accent"),
      cursorAccent: getColor("--color-background"),
      selectionBackground: `${getColor("--color-accent")}40`,
      selectionForeground: getColor("--color-text"),
      black: getColor("--color-terminal-black") || "#000000",
      red: getColor("--color-terminal-red") || "#CD3131",
      green: getColor("--color-terminal-green") || "#0DBC79",
      yellow: getColor("--color-terminal-yellow") || "#E5E510",
      blue: getColor("--color-terminal-blue") || "#2472C8",
      magenta: getColor("--color-terminal-magenta") || "#BC3FBC",
      cyan: getColor("--color-terminal-cyan") || "#11A8CD",
      white: getColor("--color-terminal-white") || "#E5E5E5",
      brightBlack: getColor("--color-terminal-bright-black") || "#666666",
      brightRed: getColor("--color-terminal-bright-red") || "#F14C4C",
      brightGreen: getColor("--color-terminal-bright-green") || "#23D18B",
      brightYellow: getColor("--color-terminal-bright-yellow") || "#F5F543",
      brightBlue: getColor("--color-terminal-bright-blue") || "#3B8EEA",
      brightMagenta: getColor("--color-terminal-bright-magenta") || "#D670D6",
      brightCyan: getColor("--color-terminal-bright-cyan") || "#29B8DB",
      brightWhite: getColor("--color-terminal-bright-white") || "#FFFFFF",
    };
  }, []);

  return { getTerminalTheme };
}
