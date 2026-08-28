import {
  CaretLeftIcon as CaretLeft,
  GearSixIcon as Settings,
  UploadIcon as Upload,
} from "@/ui/icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getThemeAppearancePreview } from "@/extensions/appearance/appearance-preview";
import { AppearancePreviewGraphic } from "@/extensions/appearance/components/appearance-preview";
import { themeRegistry } from "@/extensions/themes/theme-registry";
import { useRegisteredThemes } from "@/extensions/themes/use-registered-themes";
import { chooseThemeFile, uploadTheme } from "@/features/settings/utils/theme-upload";
import { useUIState } from "@/features/window/stores/ui-state.store";
import {
  CommandEmpty,
  CommandHeader,
  CommandHeaderAction,
  CommandInput,
  CommandItemBadge,
  CommandItemRow,
  CommandList,
} from "@/ui/command";
import { toast } from "sonner";
import { matchesSearchQuery } from "@/utils/search-match";

interface ThemeSelectorContentProps {
  isActive: boolean;
  onBack: () => void;
  onClose: () => void;
  onThemeChange: (theme: string) => void;
  currentTheme?: string;
}

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
  const registeredThemes = useRegisteredThemes();
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const activeThemeSnapshotRef = useRef<string | undefined>(undefined);
  const didCommitRef = useRef(false);

  const themes = useMemo(
    () =>
      registeredThemes.map((theme) => ({
        ...theme,
        preview: getThemeAppearancePreview(theme),
      })),
    [registeredThemes],
  );

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

  const handleUploadTheme = () => {
    chooseThemeFile((file) => {
      void uploadTheme(file).then((result) => {
        if (!result.success || !result.theme) {
          toast.error(result.error ?? "Failed to import theme", {
            description: result.details?.slice(0, 4).join("\n"),
          });
          return;
        }

        toast.success(
          result.themes?.length === 1
            ? `Imported ${result.theme.name}`
            : `Imported ${result.themes?.length ?? 0} theme variants`,
        );
        didCommitRef.current = true;
        onThemeChange(result.theme.id);
        onClose();
      });
    });
  };

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
          placeholder="Search themes..."
          role="combobox"
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls="theme-selector-results"
          aria-activedescendant={
            filteredThemes.length ? `theme-selector-option-${selectedIndex}` : undefined
          }
        />
        <CommandHeaderAction onClick={handleUploadTheme} aria-label="Upload theme">
          <Upload />
        </CommandHeaderAction>
        <CommandHeaderAction
          onClick={() => {
            onClose();
            useUIState.getState().openSettingsDialog("appearance");
          }}
          aria-label="Open appearance settings"
        >
          <Settings />
        </CommandHeaderAction>
      </CommandHeader>

      <CommandList
        ref={resultsRef}
        id="theme-selector-results"
        role="listbox"
        aria-label="Color themes"
      >
        {filteredThemes.length === 0 ? (
          <CommandEmpty>No themes found</CommandEmpty>
        ) : (
          filteredThemes.map((theme, index) => {
            const isSelected = index === selectedIndex;
            const isCurrent = theme.id === initialTheme;

            return (
              <CommandItemRow
                key={theme.id}
                as="div"
                id={`theme-selector-option-${index}`}
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
                }}
                isSelected={isSelected}
                icon={
                  theme.preview ? <AppearancePreviewGraphic preview={theme.preview} /> : undefined
                }
                contentLayout="stacked"
                title={theme.name}
                description={theme.description || theme.category}
                accessory={isCurrent ? <CommandItemBadge>Current</CommandItemBadge> : undefined}
              />
            );
          })
        )}
      </CommandList>
    </>
  );
};

ThemeSelectorContent.displayName = "ThemeSelectorContent";
