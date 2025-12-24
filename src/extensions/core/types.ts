/**
 * Unified Extension Type System
 *
 * All extensions (languages, themes, icon themes) use a single manifest format.
 * The `category` field determines which capabilities are available.
 */

// Platform and architecture types
export type Platform = "darwin" | "linux" | "win32";
export type Architecture = "arm64" | "x64";
export type PlatformArch =
  | "darwin-arm64"
  | "darwin-x64"
  | "linux-x64"
  | "linux-arm64"
  | "win32-x64";

// Extension categories
export type ExtensionCategory = "language" | "theme" | "icon-theme";

// Extension lifecycle states
export type ExtensionState =
  | "not-installed"
  | "installing"
  | "installed"
  | "activating"
  | "activated"
  | "deactivating"
  | "deactivated"
  | "error";

/**
 * Unified Extension Manifest
 *
 * Single type for all extension categories with discriminated union for capabilities.
 */
export interface ExtensionManifest {
  // Required metadata
  id: string; // Unique identifier (e.g., "athas.typescript", "athas.one-dark")
  name: string; // Short name (e.g., "TypeScript", "One Dark")
  displayName: string; // Full display name (e.g., "TypeScript Language Support")
  description: string;
  version: string; // Semver
  publisher: string;
  license?: string;

  // Category determines which capabilities are available
  category: ExtensionCategory;

  // Whether this extension ships with the app
  bundled?: boolean;

  // Extension icon (relative path or URL)
  icon?: string;

  // Repository information
  repository?: {
    type: string;
    url: string;
  };

  // Category-specific capabilities (discriminated union)
  capabilities: LanguageCapabilities | ThemeCapabilities | IconThemeCapabilities;

  // Installation metadata (only for downloadable extensions)
  installation?: InstallationMetadata;
}

// Type guards for capabilities
export function isLanguageExtension(
  manifest: ExtensionManifest,
): manifest is ExtensionManifest & { capabilities: LanguageCapabilities } {
  return manifest.category === "language";
}

export function isThemeExtension(
  manifest: ExtensionManifest,
): manifest is ExtensionManifest & { capabilities: ThemeCapabilities } {
  return manifest.category === "theme";
}

export function isIconThemeExtension(
  manifest: ExtensionManifest,
): manifest is ExtensionManifest & { capabilities: IconThemeCapabilities } {
  return manifest.category === "icon-theme";
}

/**
 * Language Extension Capabilities
 *
 * Provides syntax highlighting, LSP, formatter, linter, and snippets.
 */
export interface LanguageCapabilities {
  type: "language";

  // Language identification
  languageId: string;
  fileExtensions: string[]; // Without dot (e.g., ["ts", "tsx"])
  aliases?: string[];
  firstLine?: string; // Regex for first-line detection

  // Syntax highlighting (required for all language extensions)
  grammar: GrammarConfiguration;

  // Optional: LSP server support
  lsp?: LspConfiguration;

  // Optional: Formatter
  formatter?: FormatterConfiguration;

  // Optional: Linter
  linter?: LinterConfiguration;

  // Optional: Snippets (relative path to snippets.json)
  snippets?: string;

  // Optional: Commands contributed by this extension
  commands?: CommandContribution[];
}

/**
 * Theme Extension Capabilities
 *
 * Themes can have multiple variants (e.g., light and dark).
 */
export interface ThemeCapabilities {
  type: "theme";

  // Theme author (separate from publisher for ported themes)
  author?: string;

  // Theme variants (at least one required)
  variants: ThemeVariant[];
}

export interface ThemeVariant {
  id: string; // Unique variant ID (e.g., "one-dark", "one-light")
  name: string; // Display name
  description?: string;
  appearance: "light" | "dark";

  // UI colors (CSS variable values without -- prefix)
  colors: ThemeColors;

  // Syntax highlighting colors
  syntax: ThemeSyntax;
}

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
  // Additional optional colors
  [key: string]: string;
}

export interface ThemeSyntax {
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
  boolean: string;
  null: string;
  regex: string;
  tag: string;
  attribute: string;
  // Additional optional tokens
  [key: string]: string;
}

/**
 * Icon Theme Extension Capabilities
 *
 * JSON-based icon definitions with SVG icons.
 */
export interface IconThemeCapabilities {
  type: "icon-theme";

  // Icon definitions
  iconDefinitions: IconDefinitions;

  // Folder icons
  folder?: string; // Reference to iconDefinitions key
  folderExpanded?: string;

  // Default file icon
  file?: string;

  // File extension mappings (without dot)
  fileExtensions?: Record<string, string>;

  // Exact file name mappings
  fileNames?: Record<string, string>;

  // Folder name mappings
  folderNames?: Record<string, string>;
  folderNamesExpanded?: Record<string, string>;
}

export interface IconDefinitions {
  [key: string]: IconDefinition;
}

export interface IconDefinition {
  iconPath: string; // Relative path to SVG file within extension
}

/**
 * Grammar Configuration
 *
 * Tree-sitter based syntax highlighting.
 */
export interface GrammarConfiguration {
  // Path to tree-sitter WASM parser
  // For bundled: relative to extension directory
  // For downloadable: URL or relative path
  wasmPath: string;

  // Path to highlight query file (.scm)
  highlightQuery: string;

  // TextMate scope name (e.g., "source.typescript")
  scopeName?: string;
}

/**
 * LSP Configuration
 *
 * Language Server Protocol support.
 */
export interface LspConfiguration {
  // Server executable per platform-arch
  // For bundled: can use simple platform keys
  // For downloadable: relative paths within extension package
  server: PlatformExecutable | PlatformArchExecutable;

  // Server arguments
  args?: string[];

  // Environment variables
  env?: Record<string, string>;

  // LSP initialization options
  initializationOptions?: Record<string, unknown>;

  // File extensions this LSP handles (with dots)
  fileExtensions?: string[];

  // Language IDs this LSP handles
  languageIds?: string[];
}

export interface PlatformExecutable {
  default?: string;
  darwin?: string;
  linux?: string;
  win32?: string;
}

export interface PlatformArchExecutable {
  "darwin-arm64"?: string;
  "darwin-x64"?: string;
  "linux-x64"?: string;
  "linux-arm64"?: string;
  "win32-x64"?: string;
}

/**
 * Formatter Configuration
 */
export interface FormatterConfiguration {
  command: string | PlatformExecutable | PlatformArchExecutable;
  args?: string[];
  env?: Record<string, string>;
  inputMethod?: "stdin" | "file";
  outputMethod?: "stdout" | "file";
}

/**
 * Linter Configuration
 */
export interface LinterConfiguration {
  command: string | PlatformExecutable | PlatformArchExecutable;
  args?: string[];
  env?: Record<string, string>;
  inputMethod?: "stdin" | "file";
  diagnosticFormat?: "lsp" | "regex";
  diagnosticPattern?: string;
}

/**
 * Command Contribution
 */
export interface CommandContribution {
  command: string; // Command ID (e.g., "typescript.restartServer")
  title: string; // Display title
  category?: string; // Command category for grouping
}

/**
 * Installation Metadata
 *
 * For downloadable extensions only.
 */
export interface InstallationMetadata {
  // Minimum editor version required
  minVersion?: string;

  // Platform-specific packages
  platforms: Partial<Record<PlatformArch, PlatformPackage>>;
}

export interface PlatformPackage {
  downloadUrl: string;
  size: number; // Bytes
  checksum: string; // SHA256
}

/**
 * Installed Extension State
 *
 * Runtime state for an installed extension.
 */
export interface InstalledExtension {
  manifest: ExtensionManifest;
  state: ExtensionState;
  installedAt?: string; // ISO timestamp
  installedPath?: string; // Filesystem path for full extensions
  error?: ExtensionError;
}

export interface ExtensionError {
  code: string;
  message: string;
  stack?: string;
}

/**
 * Extension Install Progress
 */
export interface InstallProgress {
  extensionId: string;
  status: InstallStatus;
  progress: number; // 0.0 to 1.0
  message: string;
}

export type InstallStatus =
  | "downloading"
  | "extracting"
  | "verifying"
  | "installing"
  | "completed"
  | "failed";

/**
 * Extension Registry Entry
 *
 * Entry in the remote extension registry (registry.json on CDN).
 */
export interface RegistryEntry {
  id: string;
  name: string;
  displayName: string;
  description: string;
  version: string;
  publisher: string;
  category: ExtensionCategory;
  icon?: string;
  downloads?: number;
  rating?: number;
  manifestUrl: string; // URL to full extension.json
}

/**
 * Extension Registry Response
 *
 * Response from the remote registry endpoint.
 */
export interface ExtensionRegistry {
  version: string;
  lastUpdated: string;
  extensions: RegistryEntry[];
}
