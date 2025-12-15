/**
 * Theme Schema
 *
 * Theme files are standalone JSON files.
 * Users can create themes by dropping JSON files into ~/.config/athas/themes/
 */

/**
 * Root theme file structure
 * One file can contain multiple theme variants (e.g., dark + light)
 */
export interface ThemeFile {
  /** JSON Schema URL for validation */
  $schema?: string;

  /** Theme family name (e.g., "Catppuccin", "GitHub", "Nord") */
  name: string;

  /** Theme author */
  author?: string;

  /** Theme family description */
  description?: string;

  /** Repository URL */
  repository?: string;

  /** License */
  license?: string;

  /** Version */
  version?: string;

  /** Array of theme variants */
  themes: Theme[];
}

/**
 * Individual theme variant
 */
export interface Theme {
  /** Unique ID for this theme (e.g., "catppuccin-mocha") */
  id: string;

  /** Display name (e.g., "Catppuccin Mocha") */
  name: string;

  /** Description */
  description?: string;

  /** Theme appearance: "dark" or "light" */
  appearance: "dark" | "light";

  /** UI color variables */
  colors: ThemeColors;

  /** Syntax highlighting colors */
  syntax: SyntaxColors;
}

/**
 * UI Colors
 */
export interface ThemeColors {
  "primary-bg": string;
  "secondary-bg": string;
  text: string;
  "text-light": string;
  "text-lighter": string;
  border: string;
  hover: string;
  selected: string;
  accent: string;

  // Optional
  error?: string;
  warning?: string;
  success?: string;
  info?: string;
  cursor?: string;
  "line-highlight"?: string;
  "selection-bg"?: string;
  "git-added"?: string;
  "git-modified"?: string;
  "git-deleted"?: string;
}

/**
 * Syntax Highlighting Colors
 */
export interface SyntaxColors {
  keyword: string;
  string: string;
  number: string;
  comment: string;
  variable: string;
  function: string;
  constant: string;
  property: string;
  type: string;
  operator: string;
  punctuation: string;
  boolean?: string;
  null?: string;
  regex?: string;
  tag?: string;
  attribute?: string;
}
