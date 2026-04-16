import {
  AlertCircle,
  Blocks,
  Database,
  Languages,
  Package,
  Palette,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { CreateExtensionWizard } from "@/extensions/ui/components/create-extension-wizard";
import { iconThemeRegistry } from "@/extensions/icon-themes/icon-theme-registry";
import { useExtensionStore } from "@/extensions/registry/extension-store";
import type { ExtensionRuntimeIssue } from "@/extensions/registry/extension-store-types";
import { useUIExtensionStore } from "@/extensions/ui/stores/ui-extension-store";
import { themeRegistry } from "@/extensions/themes/theme-registry";
import { uiExtensionHost } from "@/extensions/ui/services/ui-extension-host";
import { extensionManager } from "@/features/editor/extensions/manager";
import { useToast } from "@/features/layout/contexts/toast-context";
import { useSettingsStore } from "@/features/settings/store";
import { useUIState } from "@/features/window/stores/ui-state-store";
import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
import Dialog from "@/ui/dialog";
import Input from "@/ui/input";
import { cn } from "@/utils/cn";
import { ProActionButton } from "../pro-action-button";

interface UnifiedExtension {
  id: string;
  name: string;
  description: string;
  category: "language" | "theme" | "icon-theme" | "database" | "ui";
  isInstalled: boolean;
  version?: string;
  extensions?: string[];
  publisher?: string;
  isMarketplace?: boolean;
  isBundled?: boolean;
  runtimeIssues?: ExtensionRuntimeIssue[];
}

const FILTER_TABS = [
  { id: "all", label: "All" },
  { id: "language", label: "Languages", icon: Languages },
  { id: "theme", label: "Themes", icon: Palette },
  { id: "icon-theme", label: "Icon Themes", icon: Package },
  { id: "database", label: "Databases", icon: Database },
  { id: "ui", label: "Custom", icon: Blocks },
] as const;

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
    case "ui":
      return "Custom";
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
  hasRuntimeIssue,
}: {
  extension: UnifiedExtension;
  onToggle: () => void;
  onUpdate?: () => void;
  isInstalling?: boolean;
  hasUpdate?: boolean;
  hasRuntimeIssue?: boolean;
}) => {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border px-1 py-3 transition-colors hover:bg-hover">
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <span className="ui-font ui-text-md text-text">{extension.name}</span>
          <Badge variant="default" size="compact" shape="pill">
            {getCategoryLabel(extension.category)}
          </Badge>
          {extension.version && (
            <span className="ui-font ui-text-sm text-text-lighter">v{extension.version}</span>
          )}
        </div>
        <p className="ui-font ui-text-sm text-text-lighter">{extension.description}</p>
        {extension.runtimeIssues && extension.runtimeIssues.length > 0 && (
          <div className="mt-1 rounded-lg border border-error/20 bg-error/8 px-2 py-1.5">
            <div className="ui-font ui-text-sm flex items-start gap-1.5 text-error">
              <AlertCircle className="mt-0.5 shrink-0" />
              <span>{extension.runtimeIssues[0].message}</span>
            </div>
          </div>
        )}
        <div className="ui-font ui-text-sm mt-1 flex items-center gap-2 text-text-lighter">
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
        <Badge variant="accent" size="compact" className="shrink-0 rounded-full">
          Built-in
        </Badge>
      ) : isInstalling ? (
        <div className="flex shrink-0 items-center gap-1.5 text-accent">
          <RefreshCw className="animate-spin" />
          <span className="ui-font ui-text-sm">Installing</span>
        </div>
      ) : extension.isInstalled ? (
        <div className="flex shrink-0 items-center gap-2">
          {(hasUpdate || hasRuntimeIssue) && onUpdate && (
            <Button onClick={onUpdate} variant="primary" size="xs" tooltip="Update available">
              {hasRuntimeIssue ? "Reinstall" : "Update"}
            </Button>
          )}
          <Button
            onClick={onToggle}
            variant="danger"
            size="xs"
            className="border-error/35 bg-error/10 text-error hover:border-error/45 hover:bg-error/15 hover:text-error"
            tooltip="Uninstall"
          >
            Uninstall
          </Button>
        </div>
      ) : (
        <Button
          onClick={onToggle}
          variant="secondary"
          size="xs"
          className="shrink-0 border-border/80 bg-primary-bg/70 text-text hover:border-border hover:bg-hover"
          tooltip="Install"
        >
          Install
        </Button>
      )}
    </div>
  );
};

export const ExtensionsSettings = () => {
  const { settings, updateSetting } = useSettingsStore();
  const activeSidebarView = useUIState((state) => state.activeSidebarView);
  const setActiveView = useUIState((state) => state.setActiveView);
  const [searchQuery, setSearchQuery] = useState("");
  const [extensions, setExtensions] = useState<UnifiedExtension[]>([]);
  const [showCreateWizard, setShowCreateWizard] = useState(false);
  const { showToast } = useToast();

  const availableExtensions = useExtensionStore.use.availableExtensions();
  const extensionsWithUpdates = useExtensionStore.use.extensionsWithUpdates();
  const { installExtension, uninstallExtension, updateExtension } = useExtensionStore.use.actions();
  const generatedUIExtensions = useUIExtensionStore.use.extensions();

  const loadAllExtensions = useCallback(() => {
    const allExtensions: UnifiedExtension[] = [];

    for (const [, ext] of availableExtensions) {
      if (ext.manifest.languages && ext.manifest.languages.length > 0) {
        const lang = ext.manifest.languages[0];
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
          isMarketplace: !isBundled,
          isBundled,
          runtimeIssues: ext.runtimeIssues,
        });
      }
    }

    themeRegistry.getAllThemes().forEach((theme) => {
      allExtensions.push({
        id: theme.id,
        name: theme.name,
        description: theme.description || `${theme.category} theme`,
        category: "theme",
        isInstalled: true,
        version: "1.0.0",
      });
    });

    iconThemeRegistry.getAllThemes().forEach((iconTheme) => {
      allExtensions.push({
        id: iconTheme.id,
        name: iconTheme.name,
        description: iconTheme.description || `${iconTheme.name} icon theme`,
        category: "icon-theme",
        isInstalled: true,
        version: "1.0.0",
      });
    });

    allExtensions.push({
      id: "sqlite-viewer",
      name: "SQLite Viewer",
      description: "View and query SQLite databases",
      category: "database",
      isInstalled: true,
      version: "1.0.0",
    });

    for (const [, ext] of availableExtensions) {
      if (ext.manifest.categories.includes("UI")) {
        const isBundled = !ext.manifest.installation;
        allExtensions.push({
          id: ext.manifest.id,
          name: ext.manifest.displayName,
          description: ext.manifest.description,
          category: "ui",
          isInstalled: ext.isInstalled,
          version: ext.manifest.version,
          publisher: ext.manifest.publisher,
          isMarketplace: !isBundled,
          isBundled,
          runtimeIssues: ext.runtimeIssues,
        });
      }
    }

    for (const [, ext] of generatedUIExtensions) {
      if (allExtensions.some((existing) => existing.id === ext.extensionId)) {
        continue;
      }

      allExtensions.push({
        id: ext.extensionId,
        name: ext.name || ext.extensionId.replace(/^user\./, ""),
        description: ext.description || "Generated UI extension",
        category: "ui",
        isInstalled: ext.state === "active" || ext.state === "loading",
        version: "Local",
        publisher: "You",
        isMarketplace: false,
        isBundled: false,
      });
    }

    setExtensions(allExtensions);
  }, [availableExtensions, generatedUIExtensions]);

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
      if (extension.isInstalled) {
        try {
          if (extension.category === "ui") {
            await uiExtensionHost.unloadExtension(extension.id);
          }
          await uninstallExtension(extension.id);
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
          if (extension.category === "ui") {
            const ext = availableExtensions.get(extension.id);
            if (ext) {
              await uiExtensionHost.loadExtension(ext.manifest, "");
            }
          }
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

    if (extension.category === "ui") {
      const uiExtensionStore = useUIExtensionStore.getState();
      const sidebarViewForExtension = Array.from(uiExtensionStore.sidebarViews.values()).find(
        (view) => view.extensionId === extension.id,
      );

      uiExtensionStore.cleanupExtension(extension.id);

      if (sidebarViewForExtension && activeSidebarView === sidebarViewForExtension.id) {
        setActiveView("files");
      }

      showToast({
        message: `${extension.name} uninstalled successfully`,
        type: "success",
        duration: 3000,
      });
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
      updateSetting("theme", extension.isInstalled ? "one-dark" : extension.id);
    } else if (extension.category === "icon-theme") {
      updateSetting("iconTheme", extension.isInstalled ? "material" : extension.id);
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
      <div className="mb-3">
        <p className="ui-font ui-text-md font-medium text-text">Extensions</p>
        <p className="mt-1 ui-font ui-text-sm text-text-lighter">
          Install built-in tools, manage marketplace extensions, and generated custom tools.
        </p>
      </div>

      <div className="mb-2 flex items-center gap-2">
        <Input
          placeholder="Search extensions..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          leftIcon={Search}
          size="sm"
          containerClassName="flex-1"
        />
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {FILTER_TABS.map((tab) => {
          const Icon = "icon" in tab ? tab.icon : undefined;
          const isActive = settings.extensionsActiveTab === tab.id;

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() =>
                updateSetting("extensionsActiveTab", tab.id as typeof settings.extensionsActiveTab)
              }
              className={cn(
                "ui-font ui-text-sm inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 transition-colors",
                isActive
                  ? "bg-primary-bg text-text shadow-sm"
                  : "text-text-lighter hover:bg-hover hover:text-text",
              )}
            >
              {Icon ? <Icon className="size-3.5" /> : null}
              {tab.label}
            </button>
          );
        })}
      </div>

      {(settings.extensionsActiveTab === "ui" || settings.extensionsActiveTab === "all") && (
        <div className="mb-3">
          <ProActionButton
            onProClick={() => setShowCreateWizard(true)}
            variant="secondary"
            size="xs"
          >
            <Plus />
            Generate Custom Extension
          </ProActionButton>
        </div>
      )}

      <div className="flex-1 overflow-auto pr-1.5">
        {filteredExtensions.length === 0 ? (
          <div className="py-8 text-center text-text-lighter">
            <Package className="mx-auto mb-1.5 opacity-50" />
            <p className="ui-font ui-text-sm">No extensions found matching your search.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredExtensions.map((extension) => {
              const extensionFromStore = availableExtensions.get(extension.id);
              const isInstalling = extensionFromStore?.isInstalling || false;
              const hasUpdate = extensionsWithUpdates.has(extension.id);
              const hasRuntimeIssue = Boolean(extension.runtimeIssues?.length);

              return (
                <ExtensionRow
                  key={extension.id}
                  extension={extension}
                  onToggle={() => handleToggle(extension)}
                  onUpdate={() => handleUpdate(extension)}
                  isInstalling={isInstalling}
                  hasUpdate={hasUpdate}
                  hasRuntimeIssue={hasRuntimeIssue}
                />
              );
            })}
          </div>
        )}
      </div>

      {showCreateWizard && (
        <Dialog
          title="Create UI Extension"
          onClose={() => setShowCreateWizard(false)}
          icon={Blocks}
          size="lg"
          classNames={{ content: "p-5" }}
        >
          <CreateExtensionWizard onClose={() => setShowCreateWizard(false)} />
        </Dialog>
      )}
    </div>
  );
};
