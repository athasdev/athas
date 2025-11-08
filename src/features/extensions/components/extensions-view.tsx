import {
  Code,
  Download,
  Languages,
  Package,
  Palette,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { iconThemeRegistry } from "@/extensions/icon-themes/icon-theme-registry";
import { extensionDownloader } from "@/extensions/marketplace/services/extension-downloader";
import type { ExtensionInstallStatus } from "@/extensions/marketplace/types/marketplace";
import { extensionRegistry } from "@/extensions/registry/extension-registry";
import { themeRegistry } from "@/extensions/themes/theme-registry";
import { extensionManager } from "@/features/editor/extensions/manager";
import { useSettingsStore } from "@/features/settings/store";
import Button from "@/ui/button";
import { cn } from "@/utils/cn";

interface UnifiedExtension {
  id: string;
  name: string;
  description: string;
  category: "language" | "theme" | "icon-theme" | "snippet" | "database";
  isInstalled: boolean;
  version?: string;
  extensions?: string[];
  publisher?: string;
  isMarketplace?: boolean;
}

interface ExtensionsViewProps {
  onThemeChange: (theme: string) => void;
  currentTheme: string;
}

const ExtensionCard = ({
  extension,
  onToggle,
  isInstalling,
}: {
  extension: UnifiedExtension;
  onToggle: () => void;
  isInstalling?: boolean;
}) => {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-secondary-bg p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="mb-1 font-medium text-sm text-text">{extension.name}</h3>
          <p className="text-text-lighter text-xs">{extension.description}</p>
          {extension.publisher && (
            <p className="mt-1 text-text-lighter text-xs">by {extension.publisher}</p>
          )}
        </div>
        {isInstalling ? (
          <div className="flex flex-shrink-0 items-center gap-1 rounded border border-accent bg-accent/5 px-2 py-1 text-accent">
            <RefreshCw size={11} className="animate-spin" />
            <span className="text-xs">Installing</span>
          </div>
        ) : extension.isInstalled ? (
          <button
            onClick={onToggle}
            disabled={!extension.isMarketplace}
            className="flex flex-shrink-0 items-center gap-1 rounded border border-border bg-transparent px-2 py-1 text-text-lighter transition-colors hover:border-red-500/50 hover:bg-red-500/5 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-50"
            title={!extension.isMarketplace ? "Cannot uninstall bundled extensions" : "Uninstall"}
          >
            <Trash2 size={11} />
            <span className="text-xs">Uninstall</span>
          </button>
        ) : (
          <button
            onClick={onToggle}
            className="flex flex-shrink-0 items-center gap-1 rounded border border-border bg-transparent px-2 py-1 text-text-lighter transition-colors hover:border-accent hover:bg-accent/5 hover:text-accent"
            title="Install"
          >
            <Download size={11} />
            <span className="text-xs">Install</span>
          </button>
        )}
      </div>
      {extension.extensions && extension.extensions.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {extension.extensions.slice(0, 5).map((ext) => (
            <span key={ext} className="rounded-sm bg-hover px-1.5 py-0.5 text-text-lighter text-xs">
              .{ext}
            </span>
          ))}
          {extension.extensions.length > 5 && (
            <span className="rounded-sm bg-hover px-1.5 py-0.5 text-text-lighter text-xs">
              +{extension.extensions.length - 5}
            </span>
          )}
        </div>
      )}
    </div>
  );
};

export default function ExtensionsView({ onThemeChange, currentTheme }: ExtensionsViewProps) {
  const { settings, updateSetting } = useSettingsStore();
  const [searchQuery, setSearchQuery] = useState("");
  const [extensions, setExtensions] = useState<UnifiedExtension[]>([]);
  const [installStatuses, setInstallStatuses] = useState<Map<string, ExtensionInstallStatus>>(
    new Map(),
  );

  const loadAllExtensions = async () => {
    const allExtensions: UnifiedExtension[] = [];

    // Load marketplace extensions
    try {
      const registry = await extensionDownloader.getRegistry();
      registry.extensions.forEach((ext) => {
        const category = ext.categories[0]?.toLowerCase() as UnifiedExtension["category"];
        if (category) {
          allExtensions.push({
            id: ext.id,
            name: ext.displayName,
            description: ext.description,
            category,
            isInstalled: extensionDownloader.isInstalled(ext.id),
            version: ext.version,
            publisher: ext.publisher,
            isMarketplace: true,
            extensions: ext.languages?.[0]?.extensions.map((e) => e.replace(".", "")),
          });
        }
      });
    } catch (error) {
      console.error("Failed to load marketplace extensions:", error);
    }

    // Load language extensions from Extension Registry (bundled extensions)
    const bundledExtensions = extensionRegistry.getAllExtensions();
    bundledExtensions.forEach((ext) => {
      if (ext.manifest.languages && ext.manifest.languages.length > 0) {
        const lang = ext.manifest.languages[0]; // Use first language for display
        allExtensions.push({
          id: ext.manifest.id,
          name: ext.manifest.displayName,
          description: ext.manifest.description,
          category: "language",
          isInstalled: ext.state === "activated" || ext.state === "installed",
          version: ext.manifest.version,
          extensions: lang.extensions.map((e) => e.replace(".", "")),
        });
      }
    });

    // Also load from Extension Manager (legacy extensions)
    const languageExtensions = extensionManager.getAllLanguageExtensions();
    languageExtensions.forEach((ext) => {
      // Skip if already added from registry
      if (!allExtensions.some((e) => e.id === ext.id)) {
        allExtensions.push({
          id: ext.id,
          name: ext.displayName,
          description: ext.description || `${ext.displayName} syntax highlighting`,
          category: "language",
          isInstalled: true,
          version: ext.version,
          extensions: ext.extensions,
        });
      }
    });

    // Load themes
    const themes = themeRegistry.getAllThemes();
    themes.forEach((theme) => {
      allExtensions.push({
        id: theme.id,
        name: theme.name,
        description: theme.description || `${theme.category} theme`,
        category: "theme",
        isInstalled: true, // All themes are pre-installed
        version: "1.0.0",
      });
    });

    // Load icon themes
    const iconThemes = iconThemeRegistry.getAllThemes();
    iconThemes.forEach((iconTheme) => {
      allExtensions.push({
        id: iconTheme.id,
        name: iconTheme.name,
        description: iconTheme.description || `${iconTheme.name} icon theme`,
        category: "icon-theme",
        isInstalled: true, // All icon themes are pre-installed
        version: "1.0.0",
      });
    });

    // Add SQLite viewer to databases
    allExtensions.push({
      id: "sqlite-viewer",
      name: "SQLite Viewer",
      description: "View and query SQLite databases",
      category: "database",
      isInstalled: true,
      version: "1.0.0",
    });

    setExtensions(allExtensions);
  };

  useEffect(() => {
    loadAllExtensions();

    const handleInstallStatus = (event: Event) => {
      const customEvent = event as CustomEvent<ExtensionInstallStatus>;
      const status = customEvent.detail;
      setInstallStatuses((prev) => new Map(prev.set(status.id, status)));

      // Reload extensions when installation completes
      if (status.status === "installed" || status.status === "failed") {
        loadAllExtensions();
      }
    };

    window.addEventListener("extension-install-status", handleInstallStatus);

    return () => {
      window.removeEventListener("extension-install-status", handleInstallStatus);
    };
  }, [currentTheme, settings.iconTheme]);

  const handleToggle = async (extension: UnifiedExtension) => {
    // Handle marketplace extensions
    if (extension.isMarketplace) {
      if (extension.isInstalled) {
        try {
          await extensionDownloader.uninstallExtension(extension.id);
          loadAllExtensions();
        } catch (error) {
          alert(`Failed to uninstall: ${error instanceof Error ? error.message : "Unknown error"}`);
        }
      } else {
        const confirmed = confirm(`Install ${extension.name}?`);
        if (!confirmed) return;

        try {
          await extensionDownloader.downloadExtension(extension.id);
        } catch (error) {
          alert(`Failed to install: ${error instanceof Error ? error.message : "Unknown error"}`);
        }
      }
      return;
    }

    // Handle bundled extensions
    if (extension.category === "language") {
      // Find the actual extension and toggle it
      const langExt = extensionManager
        .getAllLanguageExtensions()
        .find((e) => e.id === extension.id);
      if (langExt?.updateSettings) {
        const currentSettings = langExt.getSettings?.() || {};
        langExt.updateSettings({
          ...currentSettings,
          enabled: !extension.isInstalled,
        });
      }
    } else if (extension.category === "theme") {
      if (extension.isInstalled) {
        onThemeChange("auto");
      } else {
        onThemeChange(extension.id);
      }
    } else if (extension.category === "icon-theme") {
      if (extension.isInstalled) {
        updateSetting("iconTheme", "seti");
      } else {
        updateSetting("iconTheme", extension.id);
      }
    }

    // Reload to reflect changes
    setTimeout(() => loadAllExtensions(), 100);
  };

  const filteredExtensions = extensions.filter((extension) => {
    const matchesSearch =
      extension.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      extension.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesTab =
      settings.extensionsActiveTab === "all" || extension.category === settings.extensionsActiveTab;
    return matchesSearch && matchesTab;
  });

  return (
    <div className="flex h-full flex-col bg-primary-bg">
      <div className="flex items-center justify-between border-border border-b p-4">
        <h2 className="font-semibold text-lg text-text">Extensions</h2>
        <div className="relative w-64">
          <Search
            className="-translate-y-1/2 absolute top-1/2 left-2 transform text-text-lighter"
            size={16}
          />
          <input
            type="text"
            placeholder="Search extensions..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={cn(
              "w-full rounded border border-border bg-secondary-bg",
              "py-1.5 pr-4 pl-8 text-text text-xs placeholder-text-lighter",
              "focus:border-accent focus:outline-none",
            )}
          />
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto p-4">
        <Button
          onClick={() => updateSetting("extensionsActiveTab", "all")}
          variant="ghost"
          size="sm"
          data-active={settings.extensionsActiveTab === "all"}
          className={cn(
            "text-xs",
            settings.extensionsActiveTab === "all"
              ? "bg-selected text-text"
              : "bg-transparent text-text-lighter hover:bg-hover",
          )}
        >
          All
        </Button>
        <Button
          onClick={() => updateSetting("extensionsActiveTab", "language")}
          variant="ghost"
          size="sm"
          data-active={settings.extensionsActiveTab === "language"}
          className={cn(
            "flex items-center gap-1 text-xs",
            settings.extensionsActiveTab === "language"
              ? "bg-selected text-text"
              : "bg-transparent text-text-lighter hover:bg-hover",
          )}
        >
          <Languages size={14} />
          Languages
        </Button>
        <Button
          onClick={() => updateSetting("extensionsActiveTab", "theme")}
          variant="ghost"
          size="sm"
          data-active={settings.extensionsActiveTab === "theme"}
          className={cn(
            "flex items-center gap-1 text-xs",
            settings.extensionsActiveTab === "theme"
              ? "bg-selected text-text"
              : "bg-transparent text-text-lighter hover:bg-hover",
          )}
        >
          <Palette size={14} />
          Themes
        </Button>
        <Button
          onClick={() => updateSetting("extensionsActiveTab", "icon-theme")}
          variant="ghost"
          size="sm"
          data-active={settings.extensionsActiveTab === "icon-theme"}
          className={cn(
            "flex items-center gap-1 text-xs",
            settings.extensionsActiveTab === "icon-theme"
              ? "bg-selected text-text"
              : "bg-transparent text-text-lighter hover:bg-hover",
          )}
        >
          <Package size={14} />
          Icon Themes
        </Button>
        <Button
          onClick={() => updateSetting("extensionsActiveTab", "snippet")}
          variant="ghost"
          size="sm"
          data-active={settings.extensionsActiveTab === "snippet"}
          className={cn(
            "flex items-center gap-1 text-xs",
            settings.extensionsActiveTab === "snippet"
              ? "bg-selected text-text"
              : "bg-transparent text-text-lighter hover:bg-hover",
          )}
        >
          <Code size={14} />
          Snippets
        </Button>
        <Button
          onClick={() => updateSetting("extensionsActiveTab", "database")}
          variant="ghost"
          size="sm"
          data-active={settings.extensionsActiveTab === "database"}
          className={cn(
            "flex items-center gap-1 text-xs",
            settings.extensionsActiveTab === "database"
              ? "bg-selected text-text"
              : "bg-transparent text-text-lighter hover:bg-hover",
          )}
        >
          <Package size={14} />
          Databases
        </Button>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {filteredExtensions.length === 0 ? (
          <div className="py-8 text-center text-text-lighter">
            <Package size={24} className="mx-auto mb-2 opacity-50" />
            <p className="text-sm">No extensions found matching your search.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredExtensions.map((extension) => {
              const installStatus = installStatuses.get(extension.id);
              const isInstalling =
                installStatus?.status === "downloading" || installStatus?.status === "installing";

              return (
                <ExtensionCard
                  key={extension.id}
                  extension={extension}
                  onToggle={() => handleToggle(extension)}
                  isInstalling={isInstalling}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
