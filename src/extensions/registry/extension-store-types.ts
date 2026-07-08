import type { ExtensionManifest } from "../types/extension-manifest";

export type ExtensionToolType = "lsp" | "formatter" | "linter";

export interface ExtensionRuntimeIssue {
  tool: ExtensionToolType;
  message: string;
}

export interface ExtensionInstallationMetadata {
  id: string;
  name: string;
  version: string;
  installed_at: string;
  enabled: boolean;
}

export interface AvailableExtension {
  manifest: ExtensionManifest;
  isInstalled: boolean;
  isEnabled: boolean;
  isInstalling: boolean;
  installProgress?: number;
  installError?: string;
  runtimeIssues?: ExtensionRuntimeIssue[];
}
