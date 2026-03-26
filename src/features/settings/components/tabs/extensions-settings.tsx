import { Database, Languages, Package, Palette, RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { iconThemeRegistry } from "@/extensions/icon-themes/icon-theme-registry";
import { useExtensionStore } from "@/extensions/registry/extension-store";
import { themeRegistry } from "@/extensions/themes/theme-registry";
import { extensionManager } from "@/features/editor/extensions/manager";
import { useToast } from "@/features/layout/contexts/toast-context";
import { useSettingsStore } from "@/features/settings/store";
import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
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
  onUpdate,
  isInstalling,
  hasUpdate,
}: {
  extension: UnifiedExtension;
  onToggle: () => void;
  onUpdate?: () => void;
  isInstalling?: boolean;
  hasUpdate?: boolean;
}) => {
  return (
    <div className="flex items-center justify-between gap-4 border-border/50 border-b px-1 py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2">
          <span className="ui-font ui-text-md text-text">{extension.name}</span>
          <Badge variant="default" size="compact">
            {getCategoryLabel(extension.category)}
          </Badge>
          {extension.version && (
            <span className="ui-font ui-text-sm text-text-lighter">v{extension.version}</span>
          )}
        </div>
        <div className="ui-font ui-text-sm flex items-center gap-2 text-text-lighter">
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
        <Badge variant="accent" size="compact" className="shrink-0">
          Built-in
        </Badge>
      ) : isInstalling ? (
        <div className="flex shrink-0 items-center gap-1.5 text-accent">
          <RefreshCw className="animate-spin" />
          <span className="ui-font ui-text-sm">Installing</span>
        </div>
      ) : extension.isInstalled ? (
        <div className="flex shrink-0 items-center gap-2">
          {hasUpdate && onUpdate && (
            <Button onClick={onUpdate} variant="primary" size="xs" title="Update available">
              Update
            </Button>
          )}
          <Button onClick={onToggle} variant="danger" size="xs" title="Uninstall">
            Uninstall
          </Button>
        </div>
      ) : (
        <Button
          onClick={onToggle}
          variant="secondary"
          size="xs"
          className="shrink-0"
          title="Install"
        >
          Install
        </Button>
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
  const extensionsWithUpdates = useExtensionStore.use.extensionsWithUpdates();
  const { installExtension, uninstallExtension, updateExtension } = useExtensionStore.use.actions();

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

  const handleUpdate = async (extension: UnifiedExtension) => {
    try {
      await updateExtension(extension.id);
      showToast({
        message: `${extension.name} updated successfully`,
        type: "success",
        duration: 3000,
      });
    } catch (error) {
      console.error(`Failed to update ${extension.name}:`, error);
      showToast({
        message: `Failed to update ${extension.name}: ${error instanceof Error ? error.message : "Unknown error"}`,
        type: "error",
        duration: 5000,
      });
    }
  };

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
        updateSetting("theme", "one-dark");
      } else {
        updateSetting("theme", extension.id);
      }
    } else if (extension.category === "icon-theme") {
      if (extension.isInstalled) {
        updateSetting("iconTheme", "colorful-material");
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
        />
      </div>

      <div className="mb-1.5 flex flex-wrap gap-1">
        <Button
          onClick={() => updateSetting("extensionsActiveTab", "all")}
          variant="secondary"
          size="xs"
          data-active={settings.extensionsActiveTab === "all"}
        >
          All
        </Button>
        <Button
          onClick={() => updateSetting("extensionsActiveTab", "language")}
          variant="secondary"
          size="xs"
          data-active={settings.extensionsActiveTab === "language"}
          className="gap-1"
        >
          <Languages />
          Languages
        </Button>
        <Button
          onClick={() => updateSetting("extensionsActiveTab", "theme")}
          variant="secondary"
          size="xs"
          data-active={settings.extensionsActiveTab === "theme"}
          className="gap-1"
        >
          <Palette />
          Themes
        </Button>
        <Button
          onClick={() => updateSetting("extensionsActiveTab", "icon-theme")}
          variant="secondary"
          size="xs"
          data-active={settings.extensionsActiveTab === "icon-theme"}
          className="gap-1"
        >
          <Package />
          Icon Themes
        </Button>
        <Button
          onClick={() => updateSetting("extensionsActiveTab", "database")}
          variant="secondary"
          size="xs"
          data-active={settings.extensionsActiveTab === "database"}
          className="gap-1"
        >
          <Database />
          Databases
        </Button>
      </div>

      <div className="flex-1 overflow-auto pr-1.5">
        {filteredExtensions.length === 0 ? (
          <div className="py-6 text-center text-text-lighter">
            <Package className="mx-auto mb-1.5 opacity-50" />
            <p className="ui-font ui-text-sm">No extensions found matching your search.</p>
          </div>
        ) : (
          <div>
            {filteredExtensions.map((extension) => {
              const extensionFromStore = availableExtensions.get(extension.id);
              const isInstalling = extensionFromStore?.isInstalling || false;
              const hasUpdate = extensionsWithUpdates.has(extension.id);

              return (
                <ExtensionRow
                  key={extension.id}
                  extension={extension}
                  onToggle={() => handleToggle(extension)}
                  onUpdate={() => handleUpdate(extension)}
                  isInstalling={isInstalling}
                  hasUpdate={hasUpdate}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
