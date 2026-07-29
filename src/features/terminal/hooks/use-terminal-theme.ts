import { useCallback } from "react";
import { getRequiredAthasDefaultColor } from "@/extensions/themes/default-theme";

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

function athasTerminalColor(name: string): string {
  return getRequiredAthasDefaultColor("dark", name);
}

const DEFAULT_THEME: TerminalTheme = {
  background: athasTerminalColor("background"),
  foreground: athasTerminalColor("foreground"),
  cursor: athasTerminalColor("primary"),
  cursorAccent: athasTerminalColor("background"),
  selectionBackground: athasTerminalColor("selection"),
  selectionForeground: athasTerminalColor("foreground"),
  black: athasTerminalColor("terminal-black"),
  red: athasTerminalColor("terminal-red"),
  green: athasTerminalColor("terminal-green"),
  yellow: athasTerminalColor("terminal-yellow"),
  blue: athasTerminalColor("terminal-blue"),
  magenta: athasTerminalColor("terminal-magenta"),
  cyan: athasTerminalColor("terminal-cyan"),
  white: athasTerminalColor("terminal-white"),
  brightBlack: athasTerminalColor("terminal-bright-black"),
  brightRed: athasTerminalColor("terminal-bright-red"),
  brightGreen: athasTerminalColor("terminal-bright-green"),
  brightYellow: athasTerminalColor("terminal-bright-yellow"),
  brightBlue: athasTerminalColor("terminal-bright-blue"),
  brightMagenta: athasTerminalColor("terminal-bright-magenta"),
  brightCyan: athasTerminalColor("terminal-bright-cyan"),
  brightWhite: athasTerminalColor("terminal-bright-white"),
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

    const bg = getColor(["--background"], DEFAULT_THEME.background);
    const fg = getColor(["--foreground"], DEFAULT_THEME.foreground);
    const accent = getColor(["--primary"], DEFAULT_THEME.cursor);
    const syntaxKeyword = getColor(["--syntax-keyword"], DEFAULT_THEME.magenta);
    const syntaxString = getColor(["--syntax-string"], DEFAULT_THEME.green);
    const syntaxNumber = getColor(["--syntax-number"], DEFAULT_THEME.yellow);
    const syntaxFunction = getColor(["--syntax-function"], DEFAULT_THEME.blue);
    const syntaxVariable = getColor(["--syntax-variable"], DEFAULT_THEME.red);
    const syntaxOperator = getColor(["--syntax-operator"], DEFAULT_THEME.cyan);

    const black = getColor(["--terminal-black", "--surface"], DEFAULT_THEME.black);
    const red = getColor(["--terminal-red", "--syntax-variable"], syntaxVariable);
    const green = getColor(["--terminal-green", "--syntax-string"], syntaxString);
    const yellow = getColor(
      ["--terminal-yellow", "--syntax-number", "--syntax-type"],
      syntaxNumber,
    );
    const blue = getColor(["--terminal-blue", "--syntax-function"], syntaxFunction);
    const magenta = getColor(["--terminal-magenta", "--syntax-keyword"], syntaxKeyword);
    const cyan = getColor(["--terminal-cyan", "--syntax-operator"], syntaxOperator);
    const white = getColor(
      ["--terminal-white", "--muted-foreground", "--foreground"],
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
      brightBlack: getColor(["--terminal-bright-black", "--subtle-foreground"], black),
      brightRed: getColor(["--terminal-bright-red"], red),
      brightGreen: getColor(["--terminal-bright-green"], green),
      brightYellow: getColor(["--terminal-bright-yellow"], yellow),
      brightBlue: getColor(["--terminal-bright-blue"], blue),
      brightMagenta: getColor(["--terminal-bright-magenta"], magenta),
      brightCyan: getColor(["--terminal-bright-cyan"], cyan),
      brightWhite: getColor(["--terminal-bright-white", "--foreground"], white),
    };
  }, []);

  return { getTerminalTheme };
}
