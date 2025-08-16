import { Switch } from "@headlessui/react";
import { useEffect, useState } from "react";
import { extensionManager } from "@/extensions/extension-manager";
import type { Extension } from "@/extensions/extension-types";
import { cn } from "@/utils/cn";

export function ExtensionsPage() {
  const [extensions, setExtensions] = useState<Extension[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadExtensions();
  }, []);

  const loadExtensions = () => {
    setLoading(true);
    try {
      const loadedExtensions = extensionManager.getAllNewExtensions();
      setExtensions(loadedExtensions);
    } catch (error) {
      console.error("Failed to load extensions:", error);
    } finally {
      setLoading(false);
    }
  };

  const toggleExtension = async (extension: Extension) => {
    try {
      const settings = extension.getSettings?.() || {};
      const newEnabled = !settings.enabled;

      if (extension.updateSettings) {
        extension.updateSettings({ ...settings, enabled: newEnabled });
      }

      // Reload extensions to reflect changes
      loadExtensions();
    } catch (error) {
      console.error(`Failed to toggle extension ${extension.id}:`, error);
    }
  };

  const executeCommand = async (commandId: string) => {
    try {
      await extensionManager.executeCommand(commandId);
    } catch (error) {
      console.error(`Failed to execute command ${commandId}:`, error);
    }
  };

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
          Manage your editor extensions and language support
        </p>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {extensions.length === 0 ? (
          <div className="py-8 text-center">
            <div className="mb-2 text-text-lighter">No extensions installed</div>
            <div className="text-sm text-text-lighter">
              Extensions provide additional functionality like language support and themes
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {extensions.map((extension) => {
              const settings = extension.getSettings?.() || {};
              const isEnabled = settings.enabled !== false; // Default to enabled

              return (
                <div
                  key={extension.id}
                  className={cn(
                    "rounded-lg border border-border bg-secondary-bg p-4",
                    !isEnabled && "opacity-60",
                  )}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="mb-2 flex items-center gap-3">
                        <h3 className="font-semibold text-text">{extension.displayName}</h3>
                        <span className="rounded bg-accent/20 px-2 py-0.5 text-accent text-xs">
                          v{extension.version}
                        </span>
                        {extension.category && (
                          <span className="rounded bg-border px-2 py-0.5 text-text-lighter text-xs">
                            {extension.category}
                          </span>
                        )}
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
                      {extension.contributes?.commands &&
                        extension.contributes.commands.length > 0 && (
                          <div className="mb-3">
                            <h4 className="mb-2 font-medium text-sm text-text">Commands:</h4>
                            <div className="space-y-1">
                              {extension.contributes.commands.map((command) => (
                                <button
                                  key={command.id}
                                  onClick={() => executeCommand(command.id)}
                                  className="block w-full rounded bg-hover px-2 py-1 text-left text-text text-xs transition-colors hover:bg-selected"
                                  disabled={!isEnabled}
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
                      <Switch
                        checked={isEnabled}
                        onChange={() => toggleExtension(extension)}
                        className={cn(
                          "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                          isEnabled ? "bg-accent" : "bg-border",
                        )}
                      >
                        <span
                          className={cn(
                            "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
                            isEnabled ? "translate-x-6" : "translate-x-1",
                          )}
                        />
                      </Switch>
                      <span className="text-text-lighter text-xs">
                        {isEnabled ? "Enabled" : "Disabled"}
                      </span>
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
