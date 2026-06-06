import { CaretLeftIcon as CaretLeft, PaletteIcon as Palette } from "@phosphor-icons/react";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRegisteredIconThemes } from "@/extensions/icon-themes/use-registered-icon-themes";
import { Button } from "@/ui/button";
import { CommandEmpty, CommandHeader, CommandInput, CommandItem, CommandList } from "@/ui/command";
import Badge from "@/ui/badge";
import { matchesSearchQuery } from "@/utils/search-match";

interface IconThemeInfo {
  id: string;
  name: string;
  description: string;
  icon?: React.ReactNode;
}

interface IconThemeSelectorContentProps {
  isActive: boolean;
  onBack: () => void;
  onClose: () => void;
  onThemeChange: (theme: string) => void;
  currentTheme?: string;
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
        icon: <Palette />,
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
    (e: KeyboardEvent) => {
      if (!filteredThemes.length) return;

      let nextIndex = selectedIndex;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        nextIndex = (selectedIndex + 1) % filteredThemes.length;
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        nextIndex = (selectedIndex - 1 + filteredThemes.length) % filteredThemes.length;
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

  // Reset state when visibility changes
  useEffect(() => {
    if (isActive) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [isActive, handleKeyDown]);

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
        <div className="flex w-full items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            className="rounded"
            onClick={handleBack}
            aria-label="Back to commands"
            compact
          >
            <CaretLeft className="text-text-lighter" />
          </Button>
          <CommandInput
            ref={inputRef}
            value={query}
            onChange={setQuery}
            placeholder="Search icon themes..."
            className="flex-1"
          />
        </div>
      </CommandHeader>

      <CommandList ref={resultsRef}>
        {filteredThemes.length === 0 ? (
          <CommandEmpty>No icon themes found</CommandEmpty>
        ) : (
          filteredThemes.map((theme, index) => {
            const isSelected = index === selectedIndex;
            const isCurrent = theme.id === currentTheme;
            const isPreviewing = previewTheme !== null;

            return (
              <CommandItem
                key={theme.id}
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
                className="gap-3 px-2 py-1.5"
              >
                <div className="shrink-0 text-text-lighter">{theme.icon || <Palette />}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 truncate ui-text-xs">
                    <span className="truncate">{theme.name}</span>
                    {isCurrent && !isPreviewing && (
                      <Badge variant="accent" className="px-1 py-0.5">
                        current
                      </Badge>
                    )}
                  </div>
                </div>
              </CommandItem>
            );
          })
        )}
      </CommandList>
    </>
  );
};

IconThemeSelectorContent.displayName = "IconThemeSelectorContent";

export default IconThemeSelectorContent;
