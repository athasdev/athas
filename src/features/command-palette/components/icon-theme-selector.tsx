import { CaretLeftIcon as CaretLeft } from "@/ui/icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconThemeGraphic } from "@/extensions/icon-themes/components/icon-theme-graphic";
import type { IconResult, IconThemeDefinition } from "@/extensions/icon-themes/icon-theme.types";
import { useRegisteredIconThemes } from "@/extensions/icon-themes/use-registered-icon-themes";
import {
  CommandEmpty,
  CommandHeader,
  CommandHeaderAction,
  CommandInput,
  CommandItemBadge,
  CommandItemRow,
  CommandList,
} from "@/ui/command";
import { matchesSearchQuery } from "@/utils/search-match";

interface IconThemeInfo {
  id: string;
  name: string;
  description: string;
  previewIcon: IconResult | null;
}

interface IconThemeSelectorContentProps {
  isActive: boolean;
  onBack: () => void;
  onClose: () => void;
  onThemeChange: (theme: string) => void;
  currentTheme?: string;
}

function getRepresentativeIcon(theme: IconThemeDefinition): IconResult | null {
  const candidates: Array<[string, boolean]> = [
    ["index.ts", false],
    ["package.json", false],
    ["src", true],
  ];

  for (const [fileName, isDir] of candidates) {
    const result = theme.getFileIcon(fileName, isDir);
    if (result.svg || result.url || result.component) return result;
  }

  return null;
}

export const IconThemeSelectorContent = ({
  isActive,
  onBack,
  onClose,
  onThemeChange,
  currentTheme,
}: IconThemeSelectorContentProps) => {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [initialTheme, setInitialTheme] = useState(currentTheme);
  const [previewTheme, setPreviewTheme] = useState<string | null>(null);
  const registeredThemes = useRegisteredIconThemes();
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const activeThemeSnapshotRef = useRef<string | undefined>(undefined);
  const didCommitRef = useRef(false);

  const themes = useMemo<IconThemeInfo[]>(
    () =>
      registeredThemes.map((theme) => ({
        id: theme.id,
        name: theme.name,
        description: theme.description,
        previewIcon: getRepresentativeIcon(theme),
      })),
    [registeredThemes],
  );

  // Filter themes based on query
  const filteredThemes = themes.filter(
    (theme) => !query.trim() || matchesSearchQuery(query, [theme.name, theme.description ?? ""]),
  );

  // Handle keyboard navigation
  useEffect(() => {
    if (!isActive) {
      if (activeThemeSnapshotRef.current && !didCommitRef.current) {
        onThemeChange(activeThemeSnapshotRef.current);
      }
      activeThemeSnapshotRef.current = undefined;
      return;
    }

    if (activeThemeSnapshotRef.current !== undefined) return;

    const snapshotTheme = currentTheme;
    activeThemeSnapshotRef.current = snapshotTheme;
    didCommitRef.current = false;
    setInitialTheme(snapshotTheme);
    setQuery("");
    setPreviewTheme(null);

    const initialIndex = themes.findIndex((t) => t.id === snapshotTheme);
    setSelectedIndex(initialIndex >= 0 ? initialIndex : 0);

    requestAnimationFrame(() => inputRef.current?.focus());
  }, [isActive, themes, currentTheme, onThemeChange]);

  useEffect(() => {
    return () => {
      if (activeThemeSnapshotRef.current && !didCommitRef.current) {
        onThemeChange(activeThemeSnapshotRef.current);
      }
    };
  }, [onThemeChange]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (!filteredThemes.length) return;

      let nextIndex = selectedIndex;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        nextIndex = (selectedIndex + 1) % filteredThemes.length;
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        nextIndex = (selectedIndex - 1 + filteredThemes.length) % filteredThemes.length;
      } else if (e.key === "Home") {
        e.preventDefault();
        nextIndex = 0;
      } else if (e.key === "End") {
        e.preventDefault();
        nextIndex = filteredThemes.length - 1;
      } else if (e.key === "Enter") {
        e.preventDefault();
        didCommitRef.current = true;
        onThemeChange(filteredThemes[selectedIndex].id);
        onClose();
        return;
      } else if (e.key === "Escape") {
        e.preventDefault();
        if (initialTheme) {
          onThemeChange(initialTheme);
        }
        onClose();
        return;
      }

      if (nextIndex !== selectedIndex) {
        setSelectedIndex(nextIndex);
        // Preview theme when navigating with keyboard
        const theme = filteredThemes[nextIndex];
        if (theme) {
          setPreviewTheme(theme.id);
          onThemeChange(theme.id);
        }
      }
    },
    [selectedIndex, filteredThemes, onThemeChange, onClose, initialTheme],
  );

  // Update selected index when query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Scroll selected item into view
  useEffect(() => {
    const selectedElement = resultsRef.current?.querySelector(`[data-index="${selectedIndex}"]`);
    selectedElement?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedIndex]);

  const handleClose = useCallback(() => {
    didCommitRef.current = false;
    if (initialTheme) {
      onThemeChange(initialTheme);
    }
    onClose();
  }, [initialTheme, onThemeChange, onClose]);

  const handleBack = useCallback(() => {
    didCommitRef.current = false;
    if (initialTheme) {
      onThemeChange(initialTheme);
    }
    onBack();
  }, [initialTheme, onBack, onThemeChange]);

  return (
    <>
      <CommandHeader onClose={handleClose}>
        <CommandHeaderAction type="button" onClick={handleBack} aria-label="Back to commands">
          <CaretLeft />
        </CommandHeaderAction>
        <CommandInput
          ref={inputRef}
          value={query}
          onChange={setQuery}
          onKeyDown={handleKeyDown}
          placeholder="Search icon themes..."
          role="combobox"
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls="icon-theme-selector-results"
          aria-activedescendant={
            filteredThemes.length ? `icon-theme-selector-option-${selectedIndex}` : undefined
          }
        />
      </CommandHeader>

      <CommandList
        ref={resultsRef}
        id="icon-theme-selector-results"
        role="listbox"
        aria-label="Icon themes"
      >
        {filteredThemes.length === 0 ? (
          <CommandEmpty>No icon themes found</CommandEmpty>
        ) : (
          filteredThemes.map((theme, index) => {
            const isSelected = index === selectedIndex;
            const isCurrent = theme.id === initialTheme;
            const isPreviewing = previewTheme !== null;

            return (
              <CommandItemRow
                key={theme.id}
                as="div"
                id={`icon-theme-selector-option-${index}`}
                role="option"
                tabIndex={-1}
                aria-selected={isSelected}
                data-index={index}
                onClick={() => {
                  didCommitRef.current = true;
                  onThemeChange(theme.id);
                  onClose();
                }}
                onMouseEnter={() => {
                  setSelectedIndex(index);
                  setPreviewTheme(theme.id);
                  onThemeChange(theme.id);
                }}
                onMouseLeave={() => {
                  if (previewTheme === theme.id) {
                    setPreviewTheme(null);
                    if (initialTheme) {
                      onThemeChange(initialTheme);
                    }
                  }
                }}
                isSelected={isSelected}
                icon={<IconThemeGraphic result={theme.previewIcon} className="size-4" />}
                iconVariant="framed"
                contentLayout="stacked"
                title={theme.name}
                description={theme.description}
                accessory={
                  isCurrent && !isPreviewing ? (
                    <CommandItemBadge>current</CommandItemBadge>
                  ) : undefined
                }
              />
            );
          })
        )}
      </CommandList>
    </>
  );
};

IconThemeSelectorContent.displayName = "IconThemeSelectorContent";
