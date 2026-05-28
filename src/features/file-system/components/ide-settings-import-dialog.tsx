import { invoke } from "@tauri-apps/api/core";
import { Check } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRecentFoldersStore } from "@/features/file-system/controllers/recent-folders-store";
import { useToast } from "@/features/layout/contexts/toast-context";
import { Button } from "@/ui/button";
import Command, {
  CommandEmpty,
  CommandHeader,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/ui/command";
import { matchesSearchQuery } from "@/utils/search-match";

interface ImportableIdeProject {
  name: string;
  path: string;
  sourceId: string;
  sourceName: string;
}

interface IdeSettingsImportDialogProps {
  onClose: () => void;
}

interface IdeImportSource {
  id: string;
  name: string;
  sourceIds: string[];
  capabilities: IdeImportCapability[];
}

interface IdeImportCapability {
  id: "recentProjects" | "settings" | "keybindings";
  label: string;
}

const RECENT_PROJECTS_CAPABILITY: IdeImportCapability = {
  id: "recentProjects",
  label: "Recent Projects",
};

const IDE_IMPORT_SOURCES: IdeImportSource[] = [
  {
    id: "vscode",
    name: "VS Code",
    sourceIds: ["vscode", "vscode-insiders", "vscodium"],
    capabilities: [RECENT_PROJECTS_CAPABILITY],
  },
  {
    id: "cursor",
    name: "Cursor",
    sourceIds: ["cursor"],
    capabilities: [RECENT_PROJECTS_CAPABILITY],
  },
  {
    id: "windsurf",
    name: "Windsurf",
    sourceIds: ["windsurf"],
    capabilities: [RECENT_PROJECTS_CAPABILITY],
  },
  {
    id: "zed",
    name: "Zed",
    sourceIds: ["zed", "zed-preview", "zed-dev"],
    capabilities: [RECENT_PROJECTS_CAPABILITY],
  },
  {
    id: "jetbrains",
    name: "JetBrains",
    sourceIds: ["jetbrains"],
    capabilities: [RECENT_PROJECTS_CAPABILITY],
  },
];

export function IdeSettingsImportDialog({ onClose }: IdeSettingsImportDialogProps) {
  const [projects, setProjects] = useState<ImportableIdeProject[]>([]);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [selectedCapabilityIds, setSelectedCapabilityIds] = useState<IdeImportCapability["id"][]>(
    [],
  );
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const importRecentFolders = useRecentFoldersStore((state) => state.importRecentFolders);
  const { showToast } = useToast();

  const importSources = useMemo(
    () =>
      IDE_IMPORT_SOURCES.map((source) => {
        const sourceIds = new Set(source.sourceIds);
        const sourceProjects = projects.filter((project) => sourceIds.has(project.sourceId));

        return {
          ...source,
          projects: sourceProjects,
        };
      }),
    [projects],
  );

  const selectedSource = useMemo(
    () => importSources.find((source) => source.id === selectedSourceId) ?? null,
    [importSources, selectedSourceId],
  );

  const filteredSources = useMemo(() => {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      return importSources;
    }

    return importSources.filter((source) =>
      matchesSearchQuery(trimmedQuery, [source.name, ...source.sourceIds]),
    );
  }, [importSources, query]);

  const filteredCapabilities = useMemo(() => {
    if (!selectedSource) {
      return [];
    }

    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      return selectedSource.capabilities;
    }

    return selectedSource.capabilities.filter((capability) =>
      matchesSearchQuery(trimmedQuery, [capability.label, capability.id]),
    );
  }, [query, selectedSource]);

  const currentItemCount = selectedSource ? filteredCapabilities.length : filteredSources.length;

  const loadProjects = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const nextProjects = await invoke<ImportableIdeProject[]>("get_importable_ide_projects");
      setProjects(nextProjects);
    } catch (error) {
      console.error("Failed to load editor import data:", error);
      setError(`Could not scan installed editors: ${error}`);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadProjects();
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query, selectedSourceId]);

  useEffect(() => {
    if (selectedIndex >= currentItemCount) {
      setSelectedIndex(Math.max(0, currentItemCount - 1));
    }
  }, [currentItemCount, selectedIndex]);

  const handleSelectSource = (source: (typeof importSources)[number]) => {
    setSelectedSourceId(source.id);
    setSelectedCapabilityIds(source.capabilities.map((capability) => capability.id));
    setQuery("");
  };

  const handleToggleCapability = (capability: IdeImportCapability) => {
    setSelectedCapabilityIds((selectedIds) =>
      selectedIds.includes(capability.id)
        ? selectedIds.filter((selectedId) => selectedId !== capability.id)
        : [...selectedIds, capability.id],
    );
  };

  const handleImport = () => {
    if (!selectedSource || selectedCapabilityIds.length === 0) {
      return;
    }

    if (selectedCapabilityIds.includes("recentProjects") && selectedSource.projects.length === 0) {
      showToast({
        message: `No recent projects found in ${selectedSource.name}`,
        type: "info",
      });
      return;
    }

    if (selectedCapabilityIds.includes("recentProjects")) {
      importRecentFolders(
        selectedSource.projects.map((project) => ({
          path: project.path,
          sourceId: project.sourceId,
          sourceName: project.sourceName,
        })),
      );
    }

    showToast({
      message: `Imported selected settings from ${selectedSource.name}`,
      type: "success",
    });
    onClose();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((index) =>
        currentItemCount === 0 ? 0 : Math.min(index + 1, currentItemCount - 1),
      );
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((index) => Math.max(index - 1, 0));
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();

      if (selectedSource) {
        const capability = filteredCapabilities[selectedIndex];
        if (!capability) {
          return;
        }
        handleToggleCapability(capability);
        return;
      }

      const source = filteredSources[selectedIndex];
      if (source) {
        handleSelectSource(source);
      }
    }
  };

  return (
    <Command
      isVisible
      onClose={onClose}
      title={selectedSource ? `Import from ${selectedSource.name}` : "Import Settings"}
      className="w-[520px]"
    >
      <CommandHeader onClose={onClose}>
        <CommandInput
          ref={inputRef}
          value={query}
          onChange={setQuery}
          onKeyDown={handleKeyDown}
          placeholder={selectedSource ? "Import what..." : "Import from..."}
        />
      </CommandHeader>

      <CommandList>
        {isLoading ? (
          <CommandEmpty>Scanning installed editors...</CommandEmpty>
        ) : error ? (
          <CommandEmpty>{error}</CommandEmpty>
        ) : selectedSource ? (
          filteredCapabilities.length === 0 ? (
            <CommandEmpty>No import option matches "{query}".</CommandEmpty>
          ) : (
            filteredCapabilities.map((capability, index) => (
              <CommandItem
                key={capability.id}
                isSelected={index === selectedIndex}
                onMouseEnter={() => setSelectedIndex(index)}
                onClick={() => handleToggleCapability(capability)}
                className="h-8 items-center justify-between px-3"
              >
                <span className="ui-font ui-text-sm truncate text-text">{capability.label}</span>
                <span className="flex size-4 shrink-0 items-center justify-center rounded border border-border text-accent">
                  {selectedCapabilityIds.includes(capability.id) ? <Check size={12} /> : null}
                </span>
              </CommandItem>
            ))
          )
        ) : filteredSources.length === 0 ? (
          <CommandEmpty>No import source matches "{query}".</CommandEmpty>
        ) : (
          filteredSources.map((source, index) => (
            <CommandItem
              key={source.id}
              isSelected={index === selectedIndex}
              onMouseEnter={() => setSelectedIndex(index)}
              onClick={() => handleSelectSource(source)}
              className="h-8 items-center px-3"
            >
              <span className="ui-font ui-text-sm truncate text-text">{source.name}</span>
            </CommandItem>
          ))
        )}
      </CommandList>

      {selectedSource ? (
        <div className="flex justify-end border-border border-t p-2">
          <Button
            variant="accent"
            compact
            disabled={selectedCapabilityIds.length === 0}
            onClick={handleImport}
          >
            Import
          </Button>
        </div>
      ) : null}
    </Command>
  );
}
