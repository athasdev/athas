import {
  CaretLeft,
  Monitor,
  Moon,
  Palette,
  GearSix as Settings,
  Sun,
  Upload,
} from "@phosphor-icons/react";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { themeRegistry } from "@/extensions/themes/theme-registry";
import type { ThemeDefinition } from "@/extensions/themes/types";
import { useUIState } from "@/features/window/stores/ui-state-store";
import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
import { CommandEmpty, CommandHeader, CommandInput, CommandItem, CommandList } from "@/ui/command";
import { matchesSearchQuery } from "@/utils/search-match";

interface ThemeInfo {
  id: string;
  name: string;
  description: string;
  category: "System" | "Light" | "Dark" | "Colorful";
  icon?: React.ReactNode;
}

interface ThemeSelectorContentProps {
  isActive: boolean;
  onBack: () => void;
  onClose: () => void;
  onThemeChange: (theme: string) => void;
  currentTheme?: string;
}

const getThemeIcon = (category: string): React.ReactNode => {
  switch (category) {
    case "System":
      return <Monitor />;
    case "Light":
      return <Sun />;
    case "Dark":
      return <Moon />;
    default:
      return <Palette />;
  }
};

const clampSelectedIndex = (index: number, size: number): number => {
  if (size <= 0) return 0;
  return Math.min(Math.max(index, 0), size - 1);
};

export const ThemeSelectorContent = ({
  isActive,
  onBack,
  onClose,
  onThemeChange,
  currentTheme,
}: ThemeSelectorContentProps) => {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [initialTheme, setInitialTheme] = useState(currentTheme);
  const [themes, setThemes] = useState<ThemeInfo[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const activeThemeSnapshotRef = useRef<string | undefined>(undefined);
  const didCommitRef = useRef(false);

  // Load themes from theme registry
  useEffect(() => {
    const loadThemes = () => {
      const registryThemes = themeRegistry.getAllThemes();
      const themeInfos: ThemeInfo[] = registryThemes.map(
        (theme: ThemeDefinition): ThemeInfo => ({
          id: theme.id,
          name: theme.name,
          description: theme.description,
          category: theme.category,
          icon: getThemeIcon(theme.category),
        }),
      );
      setThemes(themeInfos);
    };

    loadThemes();

    // Listen for theme registry changes
    const unsubscribe = themeRegistry.onRegistryChange(loadThemes);
    return unsubscribe;
  }, []);

  // Filter themes based on query
  const filteredThemes = themes.filter(
    (theme) =>
      !query.trim() ||
      matchesSearchQuery(query, [theme.name, theme.description ?? "", theme.category]),
  );

  const applyPreviewTheme = useCallback((themeId: string) => {
    if (!themeRegistry.getTheme(themeId)) return;
    themeRegistry.applyTheme(themeId);
  }, []);

  // Handle keyboard navigation
  useEffect(() => {
    if (!isActive) {
      if (activeThemeSnapshotRef.current && !didCommitRef.current) {
        applyPreviewTheme(activeThemeSnapshotRef.current);
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

    const initialIndex = themes.findIndex((t) => t.id === snapshotTheme);
    setSelectedIndex(initialIndex >= 0 ? initialIndex : 0);

    requestAnimationFrame(() => inputRef.current?.focus());
  }, [isActive, themes, currentTheme, applyPreviewTheme]);

  useEffect(() => {
    return () => {
      if (activeThemeSnapshotRef.current && !didCommitRef.current) {
        applyPreviewTheme(activeThemeSnapshotRef.current);
      }
    };
  }, [applyPreviewTheme]);

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
        const selectedTheme = filteredThemes[selectedIndex];
        if (!selectedTheme) return;
        didCommitRef.current = true;
        onThemeChange(selectedTheme.id);
        onClose();
        return;
      } else if (e.key === "Escape") {
        e.preventDefault();
        if (initialTheme) {
          applyPreviewTheme(initialTheme);
        }
        onClose();
        return;
      }

      if (nextIndex !== selectedIndex) {
        setSelectedIndex(nextIndex);
        const theme = filteredThemes[nextIndex];
        if (theme) {
          applyPreviewTheme(theme.id);
        }
      }
    },
    [selectedIndex, filteredThemes, onThemeChange, onClose, initialTheme, applyPreviewTheme],
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

  useEffect(() => {
    setSelectedIndex((prev) => clampSelectedIndex(prev, filteredThemes.length));
  }, [filteredThemes.length]);

  // Scroll selected item into view
  useEffect(() => {
    const selectedElement = resultsRef.current?.querySelector(`[data-index="${selectedIndex}"]`);
    selectedElement?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedIndex]);

  const handleClose = useCallback(() => {
    didCommitRef.current = false;
    if (initialTheme) {
      applyPreviewTheme(initialTheme);
    }
    onClose();
  }, [initialTheme, onClose, applyPreviewTheme]);

  const handleBack = useCallback(() => {
    didCommitRef.current = false;
    if (initialTheme) {
      applyPreviewTheme(initialTheme);
    }
    onBack();
  }, [initialTheme, onBack, applyPreviewTheme]);

  const handleUploadTheme = async () => {
    // Create file input element
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const { uploadTheme } = await import("@/features/settings/utils/theme-upload");
        const result = await uploadTheme(file);
        if (result.success) {
          console.log("Theme uploaded successfully:", result.theme?.name);
          // Optionally switch to the newly uploaded theme
          if (result.theme) {
            didCommitRef.current = true;
            onThemeChange(result.theme.id);
            onClose();
          }
        } else {
          console.error("Theme upload failed:", result.error);
        }
      }
    };
    input.click();
  };

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
            placeholder="Search themes..."
            className="flex-1"
          />
          <Button
            onClick={handleUploadTheme}
            variant="ghost"
            className="shrink-0 gap-1 px-2"
            aria-label="Upload theme"
            compact
          >
            <Upload />
          </Button>
          <Button
            onClick={() => {
              onClose();
              useUIState.getState().openSettingsDialog("appearance");
            }}
            variant="ghost"
            compact
            className="shrink-0 gap-1 px-2"
            aria-label="Open appearance settings"
          >
            <Settings />
          </Button>
        </div>
      </CommandHeader>

      <CommandList ref={resultsRef}>
        {filteredThemes.length === 0 ? (
          <CommandEmpty>No themes found</CommandEmpty>
        ) : (
          filteredThemes.map((theme, index) => {
            const isSelected = index === selectedIndex;
            const isCurrent = theme.id === initialTheme;

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
                }}
                isSelected={isSelected}
                className="gap-3 px-2 py-1.5"
              >
                <div className="shrink-0 text-text-lighter">{theme.icon || <Moon />}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 truncate ui-text-xs">
                    <span className="truncate">{theme.name}</span>
                    {isCurrent && (
                      <Badge variant="accent" size="compact">
                        Current
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

ThemeSelectorContent.displayName = "ThemeSelectorContent";

export default ThemeSelectorContent;
