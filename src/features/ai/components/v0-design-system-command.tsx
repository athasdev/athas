import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import {
  ArrowClockwiseIcon as RefreshCw,
  CaretLeftIcon as CaretLeft,
  GlobeHemisphereWestIcon as Globe,
  PaletteIcon as Palette,
  PlusIcon as Plus,
  TrashIcon as Trash,
} from "@phosphor-icons/react";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildV0DesignSystemProfileFromRegistry,
  createV0DesignSystemId,
  normalizeV0DesignSystems,
  parseV0DesignSystemDirectory,
  SHADCN_REGISTRY_DIRECTORY_URL,
  SUGGESTED_V0_DESIGN_SYSTEMS,
  type V0DesignSystemSuggestion,
} from "@/features/ai/lib/v0-design-systems";
import type { V0DesignSystemProfile } from "@/features/ai/types/v0-design-system.types";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
import {
  CommandEmpty,
  CommandFooter,
  CommandFooterAction,
  CommandHeader,
  CommandInput,
  CommandItem,
  CommandItemMeta,
  CommandItemTitle,
  CommandList,
} from "@/ui/command";
import Input from "@/ui/input";
import { matchesSearchQuery } from "@/utils/search-match";

interface V0DesignSystemCommandContentProps {
  isActive: boolean;
  onBack: () => void;
  onClose: () => void;
}

type DesignSystemRow =
  | {
      kind: "none";
      id: "";
      name: string;
      description: string;
      registryUrl: string;
    }
  | (V0DesignSystemProfile & { kind: "profile" })
  | (V0DesignSystemSuggestion & { kind: "suggestion" });

const NO_DESIGN_SYSTEM_ROW: DesignSystemRow = {
  kind: "none",
  id: "",
  name: "No design system",
  description: "Use v0 defaults",
  registryUrl: "",
};

function getNameFromRegistryUrl(registryUrl: string): string {
  try {
    const parsed = new URL(registryUrl);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return registryUrl.replace(/^https?:\/\//, "").replace(/\/.*$/, "") || "Design system";
  }
}

function getUniqueProfileId(
  profiles: V0DesignSystemProfile[],
  name: string,
  registryUrl: string,
): string {
  const existingProfile = profiles.find((profile) => profile.registryUrl === registryUrl);
  if (existingProfile) return existingProfile.id;

  const baseId = createV0DesignSystemId(name, registryUrl);
  let candidateId = baseId;
  let suffix = 2;

  while (profiles.some((profile) => profile.id === candidateId)) {
    candidateId = `${baseId}-${suffix}`;
    suffix += 1;
  }

  return candidateId;
}

const clampSelectedIndex = (index: number, size: number): number => {
  if (size <= 0) return 0;
  return Math.min(Math.max(index, 0), size - 1);
};

function getUniqueSuggestions(
  suggestions: V0DesignSystemSuggestion[],
  savedRegistryUrls: Set<string>,
): V0DesignSystemSuggestion[] {
  const seenRegistryUrls = new Set<string>();

  return suggestions.filter((suggestion) => {
    if (savedRegistryUrls.has(suggestion.registryUrl)) return false;
    if (seenRegistryUrls.has(suggestion.registryUrl)) return false;
    seenRegistryUrls.add(suggestion.registryUrl);
    return true;
  });
}

export function V0DesignSystemCommandContent({
  isActive,
  onBack,
  onClose,
}: V0DesignSystemCommandContentProps) {
  const { settings, updateSetting } = useSettingsStore();
  const [mode, setMode] = useState<"list" | "add">("list");
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [nameInput, setNameInput] = useState("");
  const [registryUrlInput, setRegistryUrlInput] = useState("");
  const [descriptionInput, setDescriptionInput] = useState("");
  const [formError, setFormError] = useState("");
  const [directorySuggestions, setDirectorySuggestions] = useState<V0DesignSystemSuggestion[]>([]);
  const [directoryStatus, setDirectoryStatus] = useState<"idle" | "loading" | "loaded" | "error">(
    "idle",
  );
  const [directoryError, setDirectoryError] = useState("");
  const [savingRegistryUrl, setSavingRegistryUrl] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const registryInputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  const savedRegistryUrls = useMemo(
    () => new Set(settings.v0DesignSystems.map((profile) => profile.registryUrl)),
    [settings.v0DesignSystems],
  );

  const visibleSuggestions = useMemo(
    () =>
      getUniqueSuggestions(
        [...SUGGESTED_V0_DESIGN_SYSTEMS, ...directorySuggestions],
        savedRegistryUrls,
      ),
    [directorySuggestions, savedRegistryUrls],
  );

  const rows = useMemo<DesignSystemRow[]>(
    () => [
      NO_DESIGN_SYSTEM_ROW,
      ...settings.v0DesignSystems.map((profile) => ({ ...profile, kind: "profile" as const })),
      ...visibleSuggestions.map((suggestion) => ({ ...suggestion, kind: "suggestion" as const })),
    ],
    [settings.v0DesignSystems, visibleSuggestions],
  );

  const filteredRows = useMemo(
    () =>
      rows.filter((row) => {
        if (!query.trim()) return true;
        return matchesSearchQuery(query, [
          row.name,
          row.description ?? "",
          row.registryUrl,
          row.kind === "none"
            ? "default none shadcn v0"
            : row.kind === "profile"
              ? "saved registry design system shadcn v0"
              : "public registry directory design system shadcn v0",
        ]);
      }),
    [query, rows],
  );

  const selectedRow = filteredRows[selectedIndex] ?? filteredRows[0] ?? null;

  useEffect(() => {
    if (!isActive) return;
    setMode("list");
    setQuery("");
    setSelectedIndex(0);
    setFormError("");
    requestAnimationFrame(() => searchInputRef.current?.focus());
  }, [isActive]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    setSelectedIndex((current) => clampSelectedIndex(current, filteredRows.length));
  }, [filteredRows.length]);

  useEffect(() => {
    const selectedElement = resultsRef.current?.querySelector(`[data-index="${selectedIndex}"]`);
    selectedElement?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedIndex]);

  const loadDirectorySuggestions = useCallback(async () => {
    setDirectoryStatus("loading");
    setDirectoryError("");

    try {
      const response = await tauriFetch(SHADCN_REGISTRY_DIRECTORY_URL, {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error(`Registry directory returned ${response.status}`);
      }

      const directory = await response.json();
      setDirectorySuggestions(parseV0DesignSystemDirectory(directory));
      setDirectoryStatus("loaded");
    } catch (error) {
      setDirectoryStatus("error");
      setDirectoryError(
        error instanceof Error ? error.message : "Could not load public registries",
      );
    }
  }, []);

  useEffect(() => {
    if (!isActive || directoryStatus !== "idle") return;
    void loadDirectorySuggestions();
  }, [directoryStatus, isActive, loadDirectorySuggestions]);

  const persistProfile = useCallback(
    async (profile: V0DesignSystemProfile) => {
      const nextProfiles = normalizeV0DesignSystems([
        ...settings.v0DesignSystems.filter((savedProfile) => savedProfile.id !== profile.id),
        profile,
      ]);
      await updateSetting("v0DesignSystems", nextProfiles);
      await updateSetting("activeV0DesignSystemId", profile.id);
    },
    [settings.v0DesignSystems, updateSetting],
  );

  const getProfileWithRegistryMetadata = useCallback(
    async (profile: V0DesignSystemProfile): Promise<V0DesignSystemProfile> => {
      try {
        const response = await tauriFetch(profile.registryUrl, {
          method: "GET",
          headers: { Accept: "application/json" },
        });
        if (!response.ok) return profile;

        const registry = await response.json();
        return buildV0DesignSystemProfileFromRegistry(registry, profile.registryUrl, profile);
      } catch {
        return profile;
      }
    },
    [],
  );

  const saveSuggestion = useCallback(
    async (suggestion: V0DesignSystemSuggestion) => {
      const id = getUniqueProfileId(
        settings.v0DesignSystems,
        suggestion.name,
        suggestion.registryUrl,
      );
      const fallbackProfile: V0DesignSystemProfile = {
        id,
        name: suggestion.name,
        registryUrl: suggestion.registryUrl,
        ...(suggestion.description ? { description: suggestion.description } : {}),
        ...(suggestion.homepage ? { homepage: suggestion.homepage } : {}),
      };

      setSavingRegistryUrl(suggestion.registryUrl);
      try {
        const profile = await getProfileWithRegistryMetadata(fallbackProfile);
        await persistProfile(profile);
        onClose();
      } finally {
        setSavingRegistryUrl("");
      }
    },
    [getProfileWithRegistryMetadata, onClose, persistProfile, settings.v0DesignSystems],
  );

  const selectRow = useCallback(
    (row: DesignSystemRow) => {
      if (row.kind === "suggestion") {
        void saveSuggestion(row);
        return;
      }

      void updateSetting("activeV0DesignSystemId", row.id);
      onClose();
    },
    [onClose, saveSuggestion, updateSetting],
  );

  const openAddForm = useCallback(() => {
    setMode("add");
    setNameInput("");
    setRegistryUrlInput("");
    setDescriptionInput("");
    setFormError("");
    requestAnimationFrame(() => registryInputRef.current?.focus());
  }, []);

  const saveProfile = useCallback(async () => {
    const registryUrl = registryUrlInput.trim();
    if (!registryUrl) {
      setFormError("Registry URL is required.");
      return;
    }

    const name = nameInput.trim() || getNameFromRegistryUrl(registryUrl);
    const id = getUniqueProfileId(settings.v0DesignSystems, name, registryUrl);
    const fallbackProfile: V0DesignSystemProfile = {
      id,
      name,
      registryUrl,
      ...(descriptionInput.trim() ? { description: descriptionInput.trim() } : {}),
    };
    setSavingRegistryUrl(registryUrl);

    try {
      const profile = await getProfileWithRegistryMetadata(fallbackProfile);
      await persistProfile(profile);
      onClose();
    } finally {
      setSavingRegistryUrl("");
    }
  }, [
    descriptionInput,
    getProfileWithRegistryMetadata,
    nameInput,
    onClose,
    persistProfile,
    registryUrlInput,
    settings.v0DesignSystems,
  ]);

  const removeSelectedProfile = useCallback(() => {
    if (!selectedRow || selectedRow.kind !== "profile") return;

    const nextProfiles = settings.v0DesignSystems.filter(
      (profile) => profile.id !== selectedRow.id,
    );
    void updateSetting("v0DesignSystems", nextProfiles);
    if (settings.activeV0DesignSystemId === selectedRow.id) {
      void updateSetting("activeV0DesignSystemId", "");
    }
  }, [selectedRow, settings.activeV0DesignSystemId, settings.v0DesignSystems, updateSetting]);

  const handleListKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (!filteredRows.length) return;

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedIndex((current) => (current + 1) % filteredRows.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex((current) => (current - 1 + filteredRows.length) % filteredRows.length);
        return;
      }
      if (event.key === "Home") {
        event.preventDefault();
        setSelectedIndex(0);
        return;
      }
      if (event.key === "End") {
        event.preventDefault();
        setSelectedIndex(filteredRows.length - 1);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        const row = filteredRows[selectedIndex];
        if (row) selectRow(row);
      }
    },
    [filteredRows, selectRow, selectedIndex],
  );

  const handleFormKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter" && !event.nativeEvent.isComposing) {
        event.preventDefault();
        void saveProfile();
      }
    },
    [saveProfile],
  );

  if (mode === "add") {
    return (
      <>
        <CommandHeader onClose={onClose}>
          <Button
            type="button"
            variant="ghost"
            className="rounded"
            onClick={() => {
              setMode("list");
              requestAnimationFrame(() => searchInputRef.current?.focus());
            }}
            aria-label="Back to v0 design systems"
            compact
          >
            <CaretLeft className="text-text-lighter" />
          </Button>
          <Palette className="shrink-0 text-text-lighter" size={15} weight="duotone" />
          <div className="min-w-0 flex-1 truncate ui-text-xs text-text">Add v0 design system</div>
        </CommandHeader>

        <CommandList>
          <div className="space-y-2 px-3 py-2">
            <Input
              ref={registryInputRef}
              value={registryUrlInput}
              onChange={(event) => setRegistryUrlInput(event.currentTarget.value)}
              onKeyDown={handleFormKeyDown}
              placeholder="https://example.com/r/registry.json"
              size="xs"
              spellCheck={false}
            />
            <Input
              value={nameInput}
              onChange={(event) => setNameInput(event.currentTarget.value)}
              onKeyDown={handleFormKeyDown}
              placeholder="Name"
              size="xs"
            />
            <Input
              value={descriptionInput}
              onChange={(event) => setDescriptionInput(event.currentTarget.value)}
              onKeyDown={handleFormKeyDown}
              placeholder="Notes"
              size="xs"
            />
            {formError && <div className="ui-text-xs text-error">{formError}</div>}
          </div>
        </CommandList>

        <CommandFooter>
          <CommandFooterAction
            onClick={() => void saveProfile()}
            variant="accent"
            disabled={Boolean(savingRegistryUrl)}
          >
            {savingRegistryUrl ? "Saving..." : "Save and use"}
          </CommandFooterAction>
          <CommandFooterAction onClick={() => setMode("list")}>Cancel</CommandFooterAction>
        </CommandFooter>
      </>
    );
  }

  return (
    <>
      <CommandHeader onClose={onClose}>
        <div className="flex w-full items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            className="rounded"
            onClick={onBack}
            aria-label="Back to commands"
            compact
          >
            <CaretLeft className="text-text-lighter" />
          </Button>
          <Palette className="shrink-0 text-text-lighter" size={15} weight="duotone" />
          <CommandInput
            ref={searchInputRef}
            value={query}
            onChange={setQuery}
            onKeyDown={handleListKeyDown}
            placeholder="Search v0 design systems..."
            className="flex-1"
          />
          <Button
            type="button"
            variant="ghost"
            className="rounded"
            onClick={() => void loadDirectorySuggestions()}
            tooltip="Refresh public registries"
            compact
          >
            <RefreshCw className="text-text-lighter" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="rounded"
            onClick={openAddForm}
            tooltip="Add registry"
            compact
          >
            <Plus className="text-text-lighter" />
          </Button>
        </div>
      </CommandHeader>

      <CommandList ref={resultsRef}>
        {filteredRows.length === 0 ? (
          <CommandEmpty>No design systems found</CommandEmpty>
        ) : (
          filteredRows.map((row, index) => {
            const isCurrent = row.id === settings.activeV0DesignSystemId;
            const isAdding = Boolean(savingRegistryUrl) && savingRegistryUrl === row.registryUrl;

            return (
              <CommandItem
                key={row.kind === "none" ? "none" : row.id}
                data-index={index}
                onClick={() => selectRow(row)}
                onMouseEnter={() => setSelectedIndex(index)}
                isSelected={index === selectedIndex}
                disabled={Boolean(savingRegistryUrl)}
                className="h-8 gap-2 px-2 py-0"
              >
                {row.kind === "suggestion" ? (
                  <Globe className="shrink-0 text-text-lighter" />
                ) : (
                  <Palette className="shrink-0 text-text-lighter" />
                )}
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <CommandItemTitle>{row.name}</CommandItemTitle>
                  <CommandItemMeta>
                    {row.kind === "none" ? row.description : row.description || row.registryUrl}
                  </CommandItemMeta>
                </div>
                {isAdding ? (
                  <Badge variant="accent" className="shrink-0 px-1 py-0.5">
                    adding
                  </Badge>
                ) : isCurrent ? (
                  <Badge variant="accent" className="shrink-0 px-1 py-0.5">
                    active
                  </Badge>
                ) : row.kind === "profile" ? (
                  <Badge variant="muted" className="shrink-0 px-1 py-0.5">
                    saved
                  </Badge>
                ) : row.kind === "suggestion" ? (
                  <Badge variant="muted" className="shrink-0 px-1 py-0.5">
                    add
                  </Badge>
                ) : null}
              </CommandItem>
            );
          })
        )}
      </CommandList>

      <CommandFooter>
        <CommandFooterAction onClick={openAddForm}>
          <Plus />
          <span>Add registry</span>
        </CommandFooterAction>
        <CommandFooterAction onClick={() => void loadDirectorySuggestions()}>
          <RefreshCw />
          <span>Refresh</span>
        </CommandFooterAction>
        <CommandFooterAction
          onClick={removeSelectedProfile}
          disabled={!selectedRow || selectedRow.kind !== "profile"}
        >
          <Trash />
          <span>Remove selected</span>
        </CommandFooterAction>
        <span className="ml-auto min-w-0 truncate px-1 ui-text-xs text-text-lighter">
          {directoryStatus === "loading"
            ? "Loading..."
            : directoryStatus === "error"
              ? directoryError
              : `${visibleSuggestions.length} public`}
        </span>
      </CommandFooter>
    </>
  );
}

V0DesignSystemCommandContent.displayName = "V0DesignSystemCommandContent";
