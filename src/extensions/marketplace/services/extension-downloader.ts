/**
 * Extension Downloader Service
 * Handles downloading and installing extensions from the marketplace
 */

import { invoke } from "@tauri-apps/api/core";
import { logger } from "@/features/editor/utils/logger";
import type {
  ExtensionInstallStatus,
  InstalledExtension,
  MarketplaceExtension,
  MarketplaceRegistry,
} from "../types/marketplace";

const REGISTRY_URL = "https://raw.githubusercontent.com/athasdev/extensions/main/registry.json";
const STORAGE_KEY = "installed_extensions";

class ExtensionDownloader {
  private installedExtensions: Map<string, InstalledExtension> = new Map();
  private installStatus: Map<string, ExtensionInstallStatus> = new Map();
  private registry: MarketplaceRegistry | null = null;

  constructor() {
    this.loadInstalledExtensions();
  }

  /**
   * Fetch the extension registry from GitHub
   */
  async fetchRegistry(): Promise<MarketplaceRegistry> {
    try {
      logger.info("ExtensionDownloader", "Fetching extension registry");

      const response = await fetch(REGISTRY_URL);
      if (!response.ok) {
        throw new Error(`Failed to fetch registry: ${response.statusText}`);
      }

      const registry: MarketplaceRegistry = await response.json();
      this.registry = registry;
      logger.info(
        "ExtensionDownloader",
        `Fetched ${registry.extensions.length} extensions from registry`,
      );

      return registry;
    } catch (error) {
      logger.error("ExtensionDownloader", "Failed to fetch registry:", error);
      throw error;
    }
  }

  /**
   * Get cached registry or fetch if not available
   */
  async getRegistry(): Promise<MarketplaceRegistry> {
    if (this.registry) {
      return this.registry;
    }
    return this.fetchRegistry();
  }

  /**
   * Search for extensions in the registry
   */
  async searchExtensions(query: string): Promise<MarketplaceExtension[]> {
    const registry = await this.getRegistry();

    if (!query.trim()) {
      return registry.extensions;
    }

    const lowerQuery = query.toLowerCase();
    return registry.extensions.filter(
      (ext) =>
        ext.name.toLowerCase().includes(lowerQuery) ||
        ext.displayName.toLowerCase().includes(lowerQuery) ||
        ext.description.toLowerCase().includes(lowerQuery) ||
        ext.categories.some((cat) => cat.toLowerCase().includes(lowerQuery)),
    );
  }

  /**
   * Get extension by ID
   */
  async getExtension(extensionId: string): Promise<MarketplaceExtension | null> {
    const registry = await this.getRegistry();
    return registry.extensions.find((ext) => ext.id === extensionId) || null;
  }

  /**
   * Download extension WASM package
   */
  async downloadExtension(extensionId: string): Promise<void> {
    const extension = await this.getExtension(extensionId);
    if (!extension) {
      throw new Error(`Extension ${extensionId} not found in registry`);
    }

    // Set status to downloading
    this.setInstallStatus(extensionId, {
      id: extensionId,
      status: "downloading",
      progress: 0,
    });

    try {
      logger.info("ExtensionDownloader", `Downloading extension ${extension.displayName}`);

      // Download using Tauri's download API
      const downloadPath = await invoke<string>("download_extension", {
        url: extension.packageUrl,
        extensionId: extension.id,
        checksum: extension.checksum,
      });

      logger.info("ExtensionDownloader", `Downloaded to: ${downloadPath}`);

      // Update status to installing
      this.setInstallStatus(extensionId, {
        id: extensionId,
        status: "installing",
        progress: 50,
      });

      // Install the extension
      await this.installExtension(extensionId, downloadPath);

      // Mark as installed
      this.markAsInstalled(extensionId, extension.version);

      this.setInstallStatus(extensionId, {
        id: extensionId,
        status: "installed",
        progress: 100,
      });

      logger.info("ExtensionDownloader", `Successfully installed ${extension.displayName}`);
    } catch (error) {
      logger.error("ExtensionDownloader", `Failed to download extension ${extensionId}:`, error);

      this.setInstallStatus(extensionId, {
        id: extensionId,
        status: "failed",
        progress: 0,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      throw error;
    }
  }

  /**
   * Install downloaded extension
   */
  private async installExtension(extensionId: string, packagePath: string): Promise<void> {
    try {
      // Install using Tauri command
      await invoke("install_extension", {
        extensionId,
        packagePath,
      });

      logger.info("ExtensionDownloader", `Extension ${extensionId} installed`);
    } catch (error) {
      logger.error("ExtensionDownloader", `Failed to install extension ${extensionId}:`, error);
      throw error;
    }
  }

  /**
   * Uninstall extension
   */
  async uninstallExtension(extensionId: string): Promise<void> {
    try {
      logger.info("ExtensionDownloader", `Uninstalling extension ${extensionId}`);

      await invoke("uninstall_extension", {
        extensionId,
      });

      this.installedExtensions.delete(extensionId);
      this.saveInstalledExtensions();

      logger.info("ExtensionDownloader", `Extension ${extensionId} uninstalled`);
    } catch (error) {
      logger.error("ExtensionDownloader", `Failed to uninstall extension ${extensionId}:`, error);
      throw error;
    }
  }

  /**
   * Check if extension is installed
   */
  isInstalled(extensionId: string): boolean {
    return this.installedExtensions.has(extensionId);
  }

  /**
   * Get installed extension info
   */
  getInstalledExtension(extensionId: string): InstalledExtension | null {
    return this.installedExtensions.get(extensionId) || null;
  }

  /**
   * Get all installed extensions
   */
  getAllInstalled(): InstalledExtension[] {
    return Array.from(this.installedExtensions.values());
  }

  /**
   * Get install status
   */
  getInstallStatus(extensionId: string): ExtensionInstallStatus | null {
    return this.installStatus.get(extensionId) || null;
  }

  /**
   * Set install status
   */
  private setInstallStatus(extensionId: string, status: ExtensionInstallStatus): void {
    this.installStatus.set(extensionId, status);

    // Emit event for UI to listen
    window.dispatchEvent(
      new CustomEvent("extension-install-status", {
        detail: status,
      }),
    );
  }

  /**
   * Mark extension as installed
   */
  private markAsInstalled(extensionId: string, version: string): void {
    const installed: InstalledExtension = {
      id: extensionId,
      version,
      installedAt: new Date().toISOString(),
      enabled: true,
    };

    this.installedExtensions.set(extensionId, installed);
    this.saveInstalledExtensions();
  }

  /**
   * Check for updates
   */
  async checkForUpdates(): Promise<MarketplaceExtension[]> {
    const registry = await this.getRegistry();
    const updates: MarketplaceExtension[] = [];

    for (const installed of this.installedExtensions.values()) {
      const latest = registry.extensions.find((ext) => ext.id === installed.id);

      if (latest && this.compareVersions(latest.version, installed.version) > 0) {
        updates.push(latest);
      }
    }

    logger.info("ExtensionDownloader", `Found ${updates.length} extension updates`);
    return updates;
  }

  /**
   * Compare semantic versions
   */
  private compareVersions(v1: string, v2: string): number {
    const parts1 = v1.split(".").map(Number);
    const parts2 = v2.split(".").map(Number);

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const p1 = parts1[i] || 0;
      const p2 = parts2[i] || 0;

      if (p1 > p2) return 1;
      if (p1 < p2) return -1;
    }

    return 0;
  }

  /**
   * Load installed extensions from storage
   */
  private loadInstalledExtensions(): void {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const installed: InstalledExtension[] = JSON.parse(stored);
        this.installedExtensions = new Map(installed.map((ext) => [ext.id, ext]));
        logger.info(
          "ExtensionDownloader",
          `Loaded ${this.installedExtensions.size} installed extensions`,
        );
      }
    } catch (error) {
      logger.error("ExtensionDownloader", "Failed to load installed extensions:", error);
    }
  }

  /**
   * Save installed extensions to storage
   */
  private saveInstalledExtensions(): void {
    try {
      const installed = Array.from(this.installedExtensions.values());
      localStorage.setItem(STORAGE_KEY, JSON.stringify(installed));
    } catch (error) {
      logger.error("ExtensionDownloader", "Failed to save installed extensions:", error);
    }
  }
}

// Global extension downloader instance
export const extensionDownloader = new ExtensionDownloader();
