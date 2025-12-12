import { Languages, Package, Palette, RefreshCw, Search } from "lucide-react";
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
  isBundled?: boolean;
}

const getCategoryLabel = (category: UnifiedExtension["category"]) => {
  switch (category) {
    case "language":
      return "Language";
    case "theme":
      return "Theme";
    case "icon-theme":
      return "Icon Theme";
    case "database":
      return "Database";
    default:
      return category;
  }
};

const ExtensionRow = ({
  extension,
  onToggle,
  isInstalling,
}: {
  extension: UnifiedExtension;
  onToggle: () => void;
  isInstalling?: boolean;
}) => {
  return (
    <div className="flex items-center justify-between gap-4 border-border/50 border-b px-1 py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2">
          <span className="font-medium text-sm text-text">{extension.name}</span>
          <span className="rounded bg-secondary-bg px-1.5 py-0.5 text-[10px] text-text-lighter">
            {getCategoryLabel(extension.category)}
          </span>
          {extension.version && (
            <span className="text-[10px] text-text-lighter">v{extension.version}</span>
          )}
        </div>
        <div className="flex items-center gap-2 text-text-lighter text-xs">
          {extension.publisher && <span>by {extension.publisher}</span>}
          {extension.publisher && extension.extensions && extension.extensions.length > 0 && (
            <span>·</span>
          )}
          {extension.extensions && extension.extensions.length > 0 && (
            <span>
              {extension.extensions
                .slice(0, 5)
                .map((ext) => `.${ext}`)
                .join(" ")}
              {extension.extensions.length > 5 && ` +${extension.extensions.length - 5}`}
            </span>
          )}
        </div>
      </div>
      {extension.isBundled ? (
        <span className="flex-shrink-0 text-accent text-xs">Built-in</span>
      ) : isInstalling ? (
        <div className="flex flex-shrink-0 items-center gap-1.5 text-accent">
          <RefreshCw size={12} className="animate-spin" />
          <span className="text-xs">Installing</span>
        </div>
      ) : extension.isInstalled ? (
        <button
          onClick={onToggle}
          className="flex-shrink-0 text-text-lighter text-xs transition-colors hover:text-red-500"
          title="Uninstall"
        >
          Uninstall
        </button>
      ) : (
        <button
          onClick={onToggle}
          className="flex-shrink-0 text-text-lighter text-xs transition-colors hover:text-accent"
          title="Install"
        >
          Install
        </button>
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
        // Bundled extensions don't have installation metadata (downloadUrl, checksum)
        const isBundled = !ext.manifest.installation;
        allExtensions.push({
          id: ext.manifest.id,
          name: ext.manifest.displayName,
          description: ext.manifest.description,
          category: "language",
          isInstalled: ext.isInstalled,
          version: ext.manifest.version,
          extensions: lang.extensions.map((e: string) => e.replace(".", "")),
          publisher: ext.manifest.publisher,
          isMarketplace: !isBundled, // Only marketplace extensions can be uninstalled
          isBundled,
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
          <div>
            {filteredExtensions.map((extension) => {
              const extensionFromStore = availableExtensions.get(extension.id);
              const isInstalling = extensionFromStore?.isInstalling || false;

              return (
                <ExtensionRow
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
