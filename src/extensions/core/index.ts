/**
 * Extension System Core
 *
 * Unified extension system for all extension categories:
 * - Languages (syntax highlighting, LSP, formatters, linters)
 * - Themes (color schemes)
 * - Icon Themes (file icons)
 */

// Providers
export * from "./providers";

// Registry
export { extensionRegistry } from "./registry";

// Store
export { initializeExtensionStore, useExtensionStore } from "./store";
// Types
export * from "./types";
