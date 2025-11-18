import { Download, Languages, Package, Palette, RefreshCw, Search, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { iconThemeRegistry } from "@/extensions/icon-themes/icon-theme-registry";
import { useExtensionStore } from "@/extensions/registry/extension-store";
import { themeRegistry } from "@/extensions/themes/theme-registry";
import { extensionManager } from "@/features/editor/extensions/manager";
import { useToast } from "@/features/layout/contexts/toast-context";
import { useSettingsStore } from "@/features/settings/store";
import Button from "@/ui/button";
import Input from "@/ui/input";

interface UnifiedExtension {
  id: string;
  name: string;
  description: string;
  category: "language" | "theme" | "icon-theme" | "database";
  isInstalled: boolean;
  version?: string;
  extensions?: string[];
  publisher?: string;
  isMarketplace?: boolean;
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
    <div className="flex flex-col gap-1 rounded border border-border bg-secondary-bg p-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="mb-0.5 font-medium text-text text-xs">{extension.name}</h3>
          <p className="text-[11px] text-text-lighter leading-tight">{extension.description}</p>
          {extension.publisher && (
            <p className="mt-0.5 text-[10px] text-text-lighter">by {extension.publisher}</p>
          )}
        </div>
        {isInstalling ? (
          <div className="flex flex-shrink-0 items-center gap-1 rounded border border-accent bg-accent/5 px-1.5 py-0.5 text-accent">
            <RefreshCw size={10} className="animate-spin" />
            <span className="text-[10px]">Installing</span>
          </div>
        ) : extension.isInstalled ? (
          <button
            onClick={onToggle}
            disabled={!extension.isMarketplace}
            className="flex flex-shrink-0 items-center gap-0.5 rounded border border-border bg-transparent px-1.5 py-0.5 text-text-lighter transition-colors hover:border-red-500/50 hover:bg-red-500/5 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-50"
            title={!extension.isMarketplace ? "Cannot uninstall bundled extensions" : "Uninstall"}
          >
            <Trash2 size={10} />
            <span className="text-[10px]">Uninstall</span>
          </button>
        ) : (
          <button
            onClick={onToggle}
            className="flex flex-shrink-0 items-center gap-0.5 rounded border border-border bg-transparent px-1.5 py-0.5 text-text-lighter transition-colors hover:border-accent hover:bg-accent/5 hover:text-accent"
            title="Install"
          >
            <Download size={10} />
            <span className="text-[10px]">Install</span>
          </button>
        )}
      </div>
      {extension.extensions && extension.extensions.length > 0 && (
        <div className="flex flex-wrap gap-0.5">
          {extension.extensions.slice(0, 5).map((ext) => (
            <span
              key={ext}
              className="rounded-sm bg-hover px-1 py-0.5 text-[10px] text-text-lighter"
            >
              .{ext}
            </span>
          ))}
          {extension.extensions.length > 5 && (
            <span className="rounded-sm bg-hover px-1 py-0.5 text-[10px] text-text-lighter">
              +{extension.extensions.length - 5}
            </span>
          )}
        </div>
      )}
    </div>
  );
};

export const ExtensionsSettings = () => {
  const { settings, updateSetting } = useSettingsStore();
  const [searchQuery, setSearchQuery] = useState("");
  const [extensions, setExtensions] = useState<UnifiedExtension[]>([]);
  const { showToast } = useToast();

  // Get extension store state
  const availableExtensions = useExtensionStore.use.availableExtensions();
  const { installExtension, uninstallExtension } = useExtensionStore.use.actions();

  const loadAllExtensions = useCallback(() => {
    const allExtensions: UnifiedExtension[] = [];

    // Load from new extension store (primary source)
    for (const [, ext] of availableExtensions) {
      if (ext.manifest.languages && ext.manifest.languages.length > 0) {
        const lang = ext.manifest.languages[0];
        allExtensions.push({
          id: ext.manifest.id,
          name: ext.manifest.displayName,
          description: ext.manifest.description,
          category: "language",
          isInstalled: ext.isInstalled,
          version: ext.manifest.version,
          extensions: lang.extensions.map((e: string) => e.replace(".", "")),
          publisher: ext.manifest.publisher,
          isMarketplace: true, // From new store, can be uninstalled
        });
      }
    }

    // Skip bundled extensions from extension registry for languages tab
    // They are shown from the new extension store above

    // Note: Language extensions are lazy-loaded on demand, not pre-installed
    // They are shown from the extension store above if installed

    // Load themes
    const themes = themeRegistry.getAllThemes();
    themes.forEach((theme) => {
      allExtensions.push({
        id: theme.id,
        name: theme.name,
        description: theme.description || `${theme.category} theme`,
        category: "theme",
        isInstalled: true,
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
        isInstalled: true,
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
  }, [availableExtensions]);

  useEffect(() => {
    loadAllExtensions();
  }, [settings.theme, settings.iconTheme, loadAllExtensions]);

  const handleToggle = async (extension: UnifiedExtension) => {
    if (extension.isMarketplace) {
      // Use extension store methods for marketplace extensions
      if (extension.isInstalled) {
        try {
          await uninstallExtension(extension.id);
          // UI will update automatically via useEffect when availableExtensions changes
          showToast({
            message: `${extension.name} uninstalled successfully`,
            type: "success",
            duration: 3000,
          });
        } catch (error) {
          console.error(`Failed to uninstall ${extension.name}:`, error);
          showToast({
            message: `Failed to uninstall ${extension.name}: ${error instanceof Error ? error.message : "Unknown error"}`,
            type: "error",
            duration: 5000,
          });
        }
      } else {
        try {
          await installExtension(extension.id);
          // UI will update automatically via useEffect when availableExtensions changes
          showToast({
            message: `${extension.name} installed successfully`,
            type: "success",
            duration: 3000,
          });
        } catch (error) {
          console.error(`Failed to install ${extension.name}:`, error);
          showToast({
            message: `Failed to install ${extension.name}: ${error instanceof Error ? error.message : "Unknown error"}`,
            type: "error",
            duration: 5000,
          });
        }
      }
      return;
    }

    if (extension.category === "language") {
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
        updateSetting("theme", "auto");
      } else {
        updateSetting("theme", extension.id);
      }
    } else if (extension.category === "icon-theme") {
      if (extension.isInstalled) {
        updateSetting("iconTheme", "seti");
      } else {
        updateSetting("iconTheme", extension.id);
      }
    }

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
    <div className="flex h-full flex-col">
      <div className="mb-1.5 flex items-center gap-2">
        <Input
          placeholder="Search extensions..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          leftIcon={Search}
          size="xs"
          containerClassName="flex-1"
          className="text-[11px]"
        />
      </div>

      <div className="mb-1.5 flex flex-wrap gap-1">
        <Button
          onClick={() => updateSetting("extensionsActiveTab", "all")}
          variant="ghost"
          size="xs"
          active={settings.extensionsActiveTab === "all"}
          className="h-6 px-2 text-[11px]"
        >
          All
        </Button>
        <Button
          onClick={() => updateSetting("extensionsActiveTab", "language")}
          variant="ghost"
          size="xs"
          active={settings.extensionsActiveTab === "language"}
          className="flex h-6 items-center gap-1 px-2 text-[11px]"
        >
          <Languages size={11} />
          Languages
        </Button>
        <Button
          onClick={() => updateSetting("extensionsActiveTab", "theme")}
          variant="ghost"
          size="xs"
          active={settings.extensionsActiveTab === "theme"}
          className="flex h-6 items-center gap-1 px-2 text-[11px]"
        >
          <Palette size={11} />
          Themes
        </Button>
        <Button
          onClick={() => updateSetting("extensionsActiveTab", "icon-theme")}
          variant="ghost"
          size="xs"
          active={settings.extensionsActiveTab === "icon-theme"}
          className="flex h-6 items-center gap-1 px-2 text-[11px]"
        >
          <Package size={11} />
          Icon Themes
        </Button>
        <Button
          onClick={() => updateSetting("extensionsActiveTab", "database")}
          variant="ghost"
          size="xs"
          active={settings.extensionsActiveTab === "database"}
          className="flex h-6 items-center gap-1 px-2 text-[11px]"
        >
          <Package size={11} />
          Databases
        </Button>
      </div>

      <div className="flex-1 overflow-auto pr-1.5">
        {filteredExtensions.length === 0 ? (
          <div className="py-6 text-center text-text-lighter">
            <Package size={20} className="mx-auto mb-1.5 opacity-50" />
            <p className="text-[11px]">No extensions found matching your search.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-1.5 lg:grid-cols-2">
            {filteredExtensions.map((extension) => {
              // Check if extension is currently installing from the new store
              const extensionFromStore = availableExtensions.get(extension.id);
              const isInstalling = extensionFromStore?.isInstalling || false;

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
};
