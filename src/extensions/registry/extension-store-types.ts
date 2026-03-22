import type { ExtensionManifest } from "../types/extension-manifest";

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
  isInstalling: boolean;
  installProgress?: number;
  installError?: string;
}
