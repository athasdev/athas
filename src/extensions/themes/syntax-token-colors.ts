export type ThemeAppearance = "dark" | "light";

const FALLBACK_SYNTAX_BY_APPEARANCE: Record<ThemeAppearance, Record<string, string>> = {
  light: {
    comment: "#8e9299",
    keyword: "#b85d48",
    string: "#527ca8",
    number: "#a77b32",
    function: "#2f7d55",
    variable: "#8a5f9e",
    tag: "#5f7c57",
    attribute: "#b85d48",
    punctuation: "#7e838b",
    constant: "#b85d48",
    property: "#2d67a9",
    type: "#5b754a",
    operator: "#7e838b",
    boolean: "#b85d48",
    null: "#8c6ba8",
    regex: "#5c899b",
    jsx: "#527ca8",
    "jsx-attribute": "#b85d48",
  },
  dark: {
    comment: "#777b84",
    keyword: "#e0795f",
    string: "#7aa6d8",
    number: "#d5a24a",
    function: "#93b584",
    variable: "#c8a7db",
    tag: "#80a36f",
    attribute: "#e0795f",
    punctuation: "#9fa2aa",
    constant: "#e0795f",
    property: "#93bde9",
    type: "#abc59b",
    operator: "#9fa2aa",
    boolean: "#e0795f",
    null: "#b693ce",
    regex: "#88b5c6",
    jsx: "#7aa6d8",
    "jsx-attribute": "#e0795f",
  },
};

function normalizeColor(value: string | undefined): string | null {
  if (!value) return null;

  const normalized = value.trim().toLowerCase().replace(/\s+/g, "");
  if (/^#[0-9a-f]{3}$/.test(normalized)) {
    return `#${normalized[1]}${normalized[1]}${normalized[2]}${normalized[2]}${normalized[3]}${normalized[3]}`;
  }

  return normalized;
}

function parseColor(value: string | undefined): [number, number, number] | null {
  const normalized = normalizeColor(value);
  if (!normalized) return null;

  const hex = normalized.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/);
  if (hex) {
    const value = hex[1];
    return [
      Number.parseInt(value.slice(0, 2), 16),
      Number.parseInt(value.slice(2, 4), 16),
      Number.parseInt(value.slice(4, 6), 16),
    ];
  }

  const rgb = normalized.match(/^rgba?\(([\d.]+),([\d.]+),([\d.]+)(?:,[\d.]+)?\)$/);
  if (!rgb) return null;

  return [
    Math.max(0, Math.min(255, Number(rgb[1]))),
    Math.max(0, Math.min(255, Number(rgb[2]))),
    Math.max(0, Math.min(255, Number(rgb[3]))),
  ];
}

function colorDistance(left: [number, number, number], right: [number, number, number]): number {
  const red = left[0] - right[0];
  const green = left[1] - right[1];
  const blue = left[2] - right[2];

  return Math.sqrt(red * red + green * green + blue * blue);
}

function getRawSyntaxName(key: string): string {
  if (key.startsWith("--color-syntax-")) return key.slice("--color-syntax-".length);
  if (key.startsWith("--syntax-")) return key.slice("--syntax-".length);
  return key;
}

function getColorValue(colors: Record<string, string>, key: string): string | undefined {
  return colors[key] ?? colors[`--${key}`] ?? colors[`--color-${key}`];
}

function isForegroundColor(value: string, colors: Record<string, string>): boolean {
  const foreground = getColorValue(colors, "text") ?? getColorValue(colors, "foreground");
  const normalized = normalizeColor(value);
  const text = normalizeColor(foreground);
  if (normalized && text && normalized === text) return true;

  const parsedValue = parseColor(value);
  const parsedText = parseColor(foreground);

  return !!parsedValue && !!parsedText && colorDistance(parsedValue, parsedText) < 28;
}

export function normalizeSyntaxColors(
  syntax: Record<string, string> | undefined,
  colors: Record<string, string>,
  appearance: ThemeAppearance,
): Record<string, string> {
  const fallback = FALLBACK_SYNTAX_BY_APPEARANCE[appearance];
  const normalizedSyntax: Record<string, string> = {};

  for (const [key, value] of Object.entries(syntax ?? {})) {
    normalizedSyntax[getRawSyntaxName(key)] = value;
  }

  for (const [key, fallbackValue] of Object.entries(fallback)) {
    const value = normalizedSyntax[key];
    if (!value || isForegroundColor(value, colors)) {
      normalizedSyntax[key] = fallbackValue;
    }
  }

  return normalizedSyntax;
}

export function toSyntaxTokenVariables(
  syntax: Record<string, string> | undefined,
  colors: Record<string, string>,
  appearance: ThemeAppearance,
): Record<string, string> {
  const variables: Record<string, string> = {};
  const normalizedSyntax = normalizeSyntaxColors(syntax, colors, appearance);

  for (const [key, value] of Object.entries(normalizedSyntax)) {
    variables[`--syntax-${key}`] = value;
    variables[`--color-syntax-${key}`] = value;
  }

  return variables;
}
