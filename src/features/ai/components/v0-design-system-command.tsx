import {
  CaretLeftIcon as CaretLeft,
  PaletteIcon as Palette,
  PlusIcon as Plus,
  TrashIcon as Trash,
} from "@phosphor-icons/react";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createV0DesignSystemId,
  normalizeV0DesignSystems,
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
  | (V0DesignSystemProfile & { kind: "profile" });

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
  const searchInputRef = useRef<HTMLInputElement>(null);
  const registryInputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  const rows = useMemo<DesignSystemRow[]>(
    () => [
      NO_DESIGN_SYSTEM_ROW,
      ...settings.v0DesignSystems.map((profile) => ({ ...profile, kind: "profile" as const })),
    ],
    [settings.v0DesignSystems],
  );

  const filteredRows = useMemo(
    () =>
      rows.filter((row) => {
        if (!query.trim()) return true;
        return matchesSearchQuery(query, [
          row.name,
          row.description ?? "",
          row.registryUrl,
          row.kind === "none" ? "default none shadcn v0" : "registry design system shadcn v0",
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

  const selectRow = useCallback(
    (row: DesignSystemRow) => {
      void updateSetting("activeV0DesignSystemId", row.id);
      onClose();
    },
    [onClose, updateSetting],
  );

  const openAddForm = useCallback(() => {
    setMode("add");
    setNameInput("");
    setRegistryUrlInput("");
    setDescriptionInput("");
    setFormError("");
    requestAnimationFrame(() => registryInputRef.current?.focus());
  }, []);

  const saveProfile = useCallback(() => {
    const registryUrl = registryUrlInput.trim();
    if (!registryUrl) {
      setFormError("Registry URL is required.");
      return;
    }

    const name = nameInput.trim() || getNameFromRegistryUrl(registryUrl);
    const id = getUniqueProfileId(settings.v0DesignSystems, name, registryUrl);
    const nextProfiles = normalizeV0DesignSystems([
      ...settings.v0DesignSystems.filter((profile) => profile.id !== id),
      {
        id,
        name,
        registryUrl,
        ...(descriptionInput.trim() ? { description: descriptionInput.trim() } : {}),
      },
    ]);

    void updateSetting("v0DesignSystems", nextProfiles);
    void updateSetting("activeV0DesignSystemId", id);
    onClose();
  }, [
    descriptionInput,
    nameInput,
    onClose,
    registryUrlInput,
    settings.v0DesignSystems,
    updateSetting,
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
        saveProfile();
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
          <CommandFooterAction onClick={saveProfile} variant="accent">
            Save and use
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

            return (
              <CommandItem
                key={row.kind === "none" ? "none" : row.id}
                data-index={index}
                onClick={() => selectRow(row)}
                onMouseEnter={() => setSelectedIndex(index)}
                isSelected={index === selectedIndex}
                className="h-8 gap-2 px-2 py-0"
              >
                <Palette className="shrink-0 text-text-lighter" />
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <CommandItemTitle>{row.name}</CommandItemTitle>
                  <CommandItemMeta>
                    {row.kind === "none" ? row.description : row.registryUrl}
                  </CommandItemMeta>
                </div>
                {isCurrent && (
                  <Badge variant="accent" className="shrink-0 px-1 py-0.5">
                    active
                  </Badge>
                )}
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
        <CommandFooterAction
          onClick={removeSelectedProfile}
          disabled={!selectedRow || selectedRow.kind !== "profile"}
        >
          <Trash />
          <span>Remove selected</span>
        </CommandFooterAction>
      </CommandFooter>
    </>
  );
}

V0DesignSystemCommandContent.displayName = "V0DesignSystemCommandContent";
