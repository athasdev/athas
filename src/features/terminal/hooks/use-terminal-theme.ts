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

function normalizeColorValue(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (isValidColor(trimmed)) return trimmed;
  if (typeof CSS !== "undefined" && CSS.supports("color", trimmed)) {
    return trimmed;
  }

  // Support raw RGB triplets like "255 255 255" or "255,255,255"
  if (/^\d{1,3}\s+\d{1,3}\s+\d{1,3}$/.test(trimmed)) {
    const rgb = `rgb(${trimmed})`;
    return CSS.supports("color", rgb) ? rgb : null;
  }
  if (/^\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}$/.test(trimmed)) {
    const rgb = `rgb(${trimmed})`;
    return CSS.supports("color", rgb) ? rgb : null;
  }

  return null;
}

function withAlpha(color: string, alpha: number, fallback: string): string {
  const normalized = normalizeColorValue(color);
  if (!normalized) return fallback;

  const hexMatch = normalized.match(/^#([0-9a-f]{6}|[0-9a-f]{3})$/i);
  if (hexMatch) {
    let hex = hexMatch[1];
    if (hex.length === 3) {
      hex = hex
        .split("")
        .map((c) => `${c}${c}`)
        .join("");
    }
    const r = Number.parseInt(hex.slice(0, 2), 16);
    const g = Number.parseInt(hex.slice(2, 4), 16);
    const b = Number.parseInt(hex.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  if (normalized.startsWith("rgb(")) {
    return normalized.replace(/^rgb\((.*)\)$/i, `rgb($1 / ${alpha})`);
  }
  if (normalized.startsWith("rgba(")) {
    return normalized.replace(/^rgba\((.*),\s*[^,]+\)$/i, `rgba($1, ${alpha})`);
  }

  return fallback;
}

export function useTerminalTheme() {
  const getTerminalTheme = useCallback((): TerminalTheme => {
    const computedStyle = getComputedStyle(document.documentElement);

    // Helper to get a valid CSS color from variables or use default
    const getColor = (varNames: string[], defaultValue: string): string => {
      for (const varName of varNames) {
        const value = computedStyle.getPropertyValue(varName).trim();
        const normalized = normalizeColorValue(value);
        if (normalized) {
          return normalized;
        }
      }
      return defaultValue;
    };

    const bg = getColor(["--primary-bg", "--color-primary-bg"], DEFAULT_THEME.background);
    const fg = getColor(["--text", "--color-text"], DEFAULT_THEME.foreground);
    const accent = getColor(["--accent", "--color-accent"], DEFAULT_THEME.cursor);
    const syntaxKeyword = getColor(
      ["--syntax-keyword", "--color-syntax-keyword"],
      DEFAULT_THEME.magenta,
    );
    const syntaxString = getColor(
      ["--syntax-string", "--color-syntax-string"],
      DEFAULT_THEME.green,
    );
    const syntaxNumber = getColor(
      ["--syntax-number", "--color-syntax-number"],
      DEFAULT_THEME.yellow,
    );
    const syntaxFunction = getColor(
      ["--syntax-function", "--color-syntax-function"],
      DEFAULT_THEME.blue,
    );
    const syntaxVariable = getColor(
      ["--syntax-variable", "--color-syntax-variable"],
      DEFAULT_THEME.red,
    );
    const syntaxOperator = getColor(
      ["--syntax-operator", "--color-syntax-operator"],
      DEFAULT_THEME.cyan,
    );

    const black = getColor(
      ["--terminal-black", "--color-terminal-black", "--secondary-bg", "--color-secondary-bg"],
      DEFAULT_THEME.black,
    );
    const red = getColor(
      ["--terminal-red", "--color-terminal-red", "--syntax-variable", "--color-syntax-variable"],
      syntaxVariable,
    );
    const green = getColor(
      ["--terminal-green", "--color-terminal-green", "--syntax-string", "--color-syntax-string"],
      syntaxString,
    );
    const yellow = getColor(
      [
        "--terminal-yellow",
        "--color-terminal-yellow",
        "--syntax-number",
        "--color-syntax-number",
        "--syntax-type",
        "--color-syntax-type",
      ],
      syntaxNumber,
    );
    const blue = getColor(
      ["--terminal-blue", "--color-terminal-blue", "--syntax-function", "--color-syntax-function"],
      syntaxFunction,
    );
    const magenta = getColor(
      [
        "--terminal-magenta",
        "--color-terminal-magenta",
        "--syntax-keyword",
        "--color-syntax-keyword",
      ],
      syntaxKeyword,
    );
    const cyan = getColor(
      ["--terminal-cyan", "--color-terminal-cyan", "--syntax-operator", "--color-syntax-operator"],
      syntaxOperator,
    );
    const white = getColor(
      [
        "--terminal-white",
        "--color-terminal-white",
        "--text-light",
        "--color-text-light",
        "--text",
        "--color-text",
      ],
      DEFAULT_THEME.white,
    );

    return {
      background: bg,
      foreground: fg,
      cursor: accent,
      cursorAccent: bg,
      selectionBackground: withAlpha(accent, 0.25, DEFAULT_THEME.selectionBackground),
      selectionForeground: fg,
      black,
      red,
      green,
      yellow,
      blue,
      magenta,
      cyan,
      white,
      brightBlack: getColor(
        [
          "--terminal-bright-black",
          "--color-terminal-bright-black",
          "--text-lighter",
          "--color-text-lighter",
        ],
        black,
      ),
      brightRed: getColor(["--terminal-bright-red", "--color-terminal-bright-red"], red),
      brightGreen: getColor(["--terminal-bright-green", "--color-terminal-bright-green"], green),
      brightYellow: getColor(
        ["--terminal-bright-yellow", "--color-terminal-bright-yellow"],
        yellow,
      ),
      brightBlue: getColor(["--terminal-bright-blue", "--color-terminal-bright-blue"], blue),
      brightMagenta: getColor(
        ["--terminal-bright-magenta", "--color-terminal-bright-magenta"],
        magenta,
      ),
      brightCyan: getColor(["--terminal-bright-cyan", "--color-terminal-bright-cyan"], cyan),
      brightWhite: getColor(
        ["--terminal-bright-white", "--color-terminal-bright-white", "--text", "--color-text"],
        white,
      ),
    };
  }, []);

  return { getTerminalTheme };
}
