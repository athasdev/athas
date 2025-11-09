/**
 * Extension Manifest Types
 * Defines the structure for extension packages with bundled LSP servers
 */

export type Platform = "darwin" | "linux" | "win32";

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
