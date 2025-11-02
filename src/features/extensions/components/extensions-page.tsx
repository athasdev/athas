import { Download, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { extensionManager } from "@/features/editor/extensions/manager";
import type { Extension } from "@/features/editor/extensions/types";
import { cn } from "@/utils/cn";

type ExtensionCategory = "all" | "languages" | "themes" | "icon-themes" | "snippets" | "databases";

const CATEGORIES: { id: ExtensionCategory; label: string }[] = [
  { id: "all", label: "All" },
  { id: "languages", label: "Languages" },
  { id: "themes", label: "Themes" },
  { id: "icon-themes", label: "Icon Themes" },
  { id: "snippets", label: "Snippets" },
  { id: "databases", label: "Databases" },
];

export function ExtensionsPage() {
  const [extensions, setExtensions] = useState<Extension[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<ExtensionCategory>("all");
  const [installedExtensions, setInstalledExtensions] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadExtensions();
  }, []);

  const loadExtensions = () => {
    setLoading(true);
    try {
      const loadedExtensions = extensionManager.getAllNewExtensions();
      setExtensions(loadedExtensions);

      // Track which extensions are installed (enabled)
      const installed = new Set<string>();
      loadedExtensions.forEach((ext) => {
        const settings = ext.getSettings?.() || {};
        if (settings.enabled !== false) {
          installed.add(ext.id);
        }
      });
      setInstalledExtensions(installed);
    } catch (error) {
      console.error("Failed to load extensions:", error);
    } finally {
      setLoading(false);
    }
  };

  const installExtension = async (extension: Extension) => {
    try {
      const settings = extension.getSettings?.() || {};

      if (extension.updateSettings) {
        extension.updateSettings({ ...settings, enabled: true });
      }

      setInstalledExtensions((prev) => new Set(prev).add(extension.id));

      // Reload extensions to reflect changes
      loadExtensions();
    } catch (error) {
      console.error(`Failed to install extension ${extension.id}:`, error);
    }
  };

  const uninstallExtension = async (extension: Extension) => {
    try {
      const settings = extension.getSettings?.() || {};

      if (extension.updateSettings) {
        extension.updateSettings({ ...settings, enabled: false });
      }

      setInstalledExtensions((prev) => {
        const next = new Set(prev);
        next.delete(extension.id);
        return next;
      });

      // Reload extensions to reflect changes
      loadExtensions();
    } catch (error) {
      console.error(`Failed to uninstall extension ${extension.id}:`, error);
    }
  };

  const executeCommand = async (commandId: string) => {
    try {
      await extensionManager.executeCommand(commandId);
    } catch (error) {
      console.error(`Failed to execute command ${commandId}:`, error);
    }
  };

  const getCategoryForExtension = (extension: Extension): ExtensionCategory => {
    const category = extension.category?.toLowerCase() || "";

    if (category.includes("language") || extension.contributes?.languages?.length) {
      return "languages";
    }
    if (category.includes("theme") && category.includes("icon")) {
      return "icon-themes";
    }
    if (category.includes("theme")) {
      return "themes";
    }
    if (category.includes("snippet")) {
      return "snippets";
    }
    if (category.includes("database")) {
      return "databases";
    }

    return "all";
  };

  const filteredExtensions = extensions.filter((ext) => {
    if (selectedCategory === "all") return true;
    return getCategoryForExtension(ext) === selectedCategory;
  });

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-text-lighter">Loading extensions...</div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-primary-bg text-text">
      <div className="border-border border-b p-4">
        <h1 className="font-semibold text-xl">Extensions</h1>
        <p className="text-sm text-text-lighter">
          Discover and manage extensions for languages, themes, snippets, and more
        </p>
      </div>

      {/* Category Filter */}
      <div className="border-border border-b px-4 py-2">
        <div className="flex gap-2 overflow-x-auto">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              className={cn(
                "whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors",
                selectedCategory === cat.id
                  ? "bg-accent text-white"
                  : "bg-secondary-bg text-text-lighter hover:bg-hover hover:text-text",
              )}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {filteredExtensions.length === 0 ? (
          <div className="py-8 text-center">
            <div className="mb-2 text-text-lighter">
              {selectedCategory === "all"
                ? "No extensions available"
                : `No ${CATEGORIES.find((c) => c.id === selectedCategory)?.label} extensions found`}
            </div>
            <div className="text-sm text-text-lighter">
              Extensions provide additional functionality like language support, themes, snippets,
              and database tools
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredExtensions.map((extension) => {
              const isInstalled = installedExtensions.has(extension.id);
              const extensionCategory = getCategoryForExtension(extension);

              return (
                <div
                  key={extension.id}
                  className={cn(
                    "rounded-lg border border-border bg-secondary-bg p-4 transition-opacity",
                    !isInstalled && "opacity-75",
                  )}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="mb-2 flex items-center gap-3">
                        <h3 className="font-semibold text-text">{extension.displayName}</h3>
                        <span className="rounded bg-accent/20 px-2 py-0.5 text-accent text-xs">
                          v{extension.version}
                        </span>
                        <span className="rounded bg-border px-2 py-0.5 text-text-lighter text-xs capitalize">
                          {extensionCategory}
                        </span>
                      </div>

                      {extension.description && (
                        <p className="mb-3 text-sm text-text-lighter">{extension.description}</p>
                      )}

                      {/* Languages */}
                      {extension.contributes?.languages &&
                        extension.contributes.languages.length > 0 && (
                          <div className="mb-3">
                            <h4 className="mb-1 font-medium text-sm text-text">Languages:</h4>
                            <div className="flex flex-wrap gap-1">
                              {extension.contributes.languages.map((lang) => (
                                <span
                                  key={lang.id}
                                  className="rounded bg-hover px-2 py-0.5 text-text text-xs"
                                >
                                  {lang.aliases?.[0] || lang.id}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                      {/* Commands */}
                      {isInstalled &&
                        extension.contributes?.commands &&
                        extension.contributes.commands.length > 0 && (
                          <div className="mb-3">
                            <h4 className="mb-2 font-medium text-sm text-text">Commands:</h4>
                            <div className="space-y-1">
                              {extension.contributes.commands.map((command) => (
                                <button
                                  key={command.id}
                                  onClick={() => executeCommand(command.id)}
                                  className="block w-full rounded bg-hover px-2 py-1 text-left text-text text-xs transition-colors hover:bg-selected"
                                >
                                  <span className="font-mono text-accent">{command.id}</span>
                                  <span className="ml-2">{command.title}</span>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                    </div>

                    <div className="flex flex-col items-end gap-2">
                      {isInstalled ? (
                        <button
                          onClick={() => uninstallExtension(extension)}
                          className="flex items-center gap-2 rounded-md bg-red-500/10 px-3 py-2 text-red-500 transition-colors hover:bg-red-500/20"
                          title="Uninstall extension"
                        >
                          <Trash2 size={14} />
                          <span className="text-xs">Uninstall</span>
                        </button>
                      ) : (
                        <button
                          onClick={() => installExtension(extension)}
                          className="flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-white transition-colors hover:bg-accent/90"
                          title="Install extension"
                        >
                          <Download size={14} />
                          <span className="text-xs">Install</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
