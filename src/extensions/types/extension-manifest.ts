/**
 * Extension Manifest Types
 * Defines the structure for extension packages with bundled LSP servers
 */

export type Platform = "darwin" | "linux" | "win32";
export type Architecture = "arm64" | "x64";
export type PlatformArch =
  | "darwin-arm64"
  | "darwin-x64"
  | "linux-x64"
  | "linux-arm64"
  | "win32-x64";

export interface ExtensionManifest {
  // Core metadata
  id: string; // Unique identifier (e.g., "athas.rust")
  name: string; // Display name (e.g., "Rust")
  displayName: string; // Human-readable name
  description: string;
  version: string;
  publisher: string;

  // Categories
  categories: ExtensionCategory[];

  // Language support
  languages?: LanguageContribution[];

  // LSP configuration
  lsp?: LspConfiguration;

  // Tree-sitter grammar
  grammar?: GrammarConfiguration;

  // Formatter configuration
  formatter?: FormatterConfiguration;

  // Linter configuration
  linter?: LinterConfiguration;

  // Snippets
  snippets?: SnippetContribution[];

  // Commands contributed by this extension
  commands?: CommandContribution[];

  // Keybindings
  keybindings?: KeybindingContribution[];

  // Dependencies
  dependencies?: Record<string, string>;

  // Activation events
  activationEvents?: string[];

  // Entry point (for custom extension code)
  main?: string;

  // Extension icon
  icon?: string;

  // License
  license?: string;

  // Repository
  repository?: {
    type: string;
    url: string;
  };

  // Installation metadata (for downloadable extensions)
  installation?: InstallationMetadata;
}

export type ExtensionCategory =
  | "Language"
  | "Linter"
  | "Formatter"
  | "Theme"
  | "Keymaps"
  | "Snippets"
  | "Other";

export interface LanguageContribution {
  id: string; // Language ID (e.g., "rust")
  extensions: string[]; // File extensions (e.g., [".rs"])
  aliases?: string[]; // Language aliases
  configuration?: string; // Path to language configuration
  firstLine?: string; // First line regex match
}

export interface LspConfiguration {
  // Server executable paths per platform
  server: PlatformExecutable;

  // Server arguments
  args?: string[];

  // Environment variables
  env?: Record<string, string>;

  // Initialization options
  initializationOptions?: Record<string, any>;

  // File extensions this LSP supports
  fileExtensions: string[];

  // Language IDs this LSP supports
  languageIds: string[];

  // Server capabilities override
  capabilities?: Record<string, any>;
}

// Extended LSP configuration with platform+arch support for downloadable extensions
export interface LspConfigurationWithArch {
  // Server executable paths per platform+arch (relative paths within extension)
  server: PlatformArchExecutable;

  // Server arguments
  args?: string[];

  // Environment variables
  env?: Record<string, string>;

  // Initialization options
  initializationOptions?: Record<string, unknown>;

  // File extensions this LSP supports
  fileExtensions: string[];

  // Language IDs this LSP supports
  languageIds: string[];
}

export interface PlatformArchExecutable {
  "darwin-arm64"?: string;
  "darwin-x64"?: string;
  "linux-x64"?: string;
  "linux-arm64"?: string;
  "win32-x64"?: string;
}

export interface PlatformExecutable {
  // Default executable (if platform-specific not provided)
  default?: string;

  // Platform-specific executables
  darwin?: string; // macOS
  linux?: string;
  win32?: string; // Windows
}

export interface GrammarConfiguration {
  // Path to tree-sitter grammar WASM
  wasmPath: string;

  // Scope name (e.g., "source.rust")
  scopeName: string;

  // Language ID
  languageId: string;
}

export interface CommandContribution {
  command: string; // Command ID
  title: string; // Display title
  category?: string; // Command category
  icon?: string; // Icon for command
}

export interface KeybindingContribution {
  command: string; // Command to execute
  key: string; // Key combination (e.g., "ctrl+shift+p")
  when?: string; // Context condition
  mac?: string; // macOS specific binding
  linux?: string; // Linux specific binding
  win?: string; // Windows specific binding
}

export interface BundledExtension {
  manifest: ExtensionManifest;

  // Path to extension directory
  path: string;

  // Whether this extension is bundled with the app
  isBundled: boolean;

  // Whether this extension is enabled
  isEnabled: boolean;

  // Extension state
  state: ExtensionState;
}

export type ExtensionState =
  | "not-installed"
  | "installing"
  | "installed"
  | "activating"
  | "activated"
  | "deactivating"
  | "deactivated"
  | "error";

export interface ExtensionError {
  code: string;
  message: string;
  stack?: string;
}

export interface ExtensionActivationContext {
  extensionPath: string;
  storagePath: string;
  globalStoragePath: string;
  subscriptions: Array<{ dispose: () => void }>;
}

export interface FormatterConfiguration {
  // Formatter executable per platform
  command: PlatformExecutable;

  // Arguments to pass to formatter
  args?: string[];

  // Environment variables
  env?: Record<string, string>;

  // Supported languages for this formatter
  languages: string[];

  // Format on save
  formatOnSave?: boolean;

  // Input method: 'stdin' or 'file'
  inputMethod?: "stdin" | "file";

  // Output method: 'stdout' or 'file' (modifies in-place)
  outputMethod?: "stdout" | "file";
}

export interface LinterConfiguration {
  // Linter executable per platform
  command: PlatformExecutable;

  // Arguments to pass to linter
  args?: string[];

  // Environment variables
  env?: Record<string, string>;

  // Supported languages for this linter
  languages: string[];

  // Lint on save
  lintOnSave?: boolean;

  // Lint on type
  lintOnType?: boolean;

  // Input method: 'stdin' or 'file'
  inputMethod?: "stdin" | "file";

  // Diagnostic format parser
  // 'lsp' - uses LSP diagnostic format
  // 'regex' - custom regex pattern
  diagnosticFormat?: "lsp" | "regex";

  // Regex pattern for parsing diagnostics (if diagnosticFormat is 'regex')
  diagnosticPattern?: string;
}

export interface SnippetContribution {
  // Language ID this snippet applies to
  language: string;

  // Snippet definitions
  snippets: Snippet[];
}

export interface Snippet {
  // Snippet prefix (trigger text)
  prefix: string;

  // Snippet body (lines or string)
  body: string[] | string;

  // Description
  description?: string;

  // Scope (e.g., 'source.typescript')
  scope?: string;
}

export interface InstallationMetadata {
  // Download URL for the extension package (used when no platform-specific packages)
  downloadUrl: string;

  // Package size in bytes
  size: number;

  // SHA256 checksum for verification
  checksum: string;

  // Minimum editor version required
  minEditorVersion?: string;

  // Maximum editor version supported
  maxEditorVersion?: string;

  // Platform-specific packages (legacy, platform-only)
  platforms?: {
    darwin?: PlatformPackage;
    linux?: PlatformPackage;
    win32?: PlatformPackage;
  };

  // Platform+arch specific packages (for extensions with native binaries)
  platformArch?: Partial<Record<PlatformArch, PlatformPackage>>;
}

export interface PlatformPackage {
  // Platform-specific download URL
  downloadUrl: string;

  // Platform-specific size
  size: number;

  // Platform-specific checksum
  checksum: string;
}
