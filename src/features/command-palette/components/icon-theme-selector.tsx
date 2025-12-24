import { Palette } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { iconThemeRegistry } from "@/extensions/icon-themes/icon-theme-registry";
import type { IconThemeDefinition } from "@/extensions/icon-themes/types";
import Command, {
  CommandEmpty,
  CommandHeader,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/ui/command";

interface IconThemeInfo {
  id: string;
  name: string;
  description: string;
  icon?: React.ReactNode;
}

interface IconThemeSelectorProps {
  isVisible: boolean;
  onClose: () => void;
  onThemeChange: (theme: string) => void;
  currentTheme?: string;
}

const IconThemeSelector = ({
  isVisible,
  onClose,
  onThemeChange,
  currentTheme,
}: IconThemeSelectorProps) => {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [initialTheme, setInitialTheme] = useState(currentTheme);
  const [previewTheme, setPreviewTheme] = useState<string | null>(null);
  const [themes, setThemes] = useState<IconThemeInfo[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  // Load icon themes from icon theme registry
  useEffect(() => {
    const loadThemes = () => {
      const registryThemes = iconThemeRegistry.getAllThemes();
      const themeInfos: IconThemeInfo[] = registryThemes.map(
        (theme: IconThemeDefinition): IconThemeInfo => ({
          id: theme.id,
          name: theme.name,
          description: theme.description,
          icon: <Palette size={14} />,
        }),
      );
      setThemes(themeInfos);
    };

    loadThemes();

    // Listen for icon theme registry changes
    const unsubscribe = iconThemeRegistry.onRegistryChange(loadThemes);
    return unsubscribe;
  }, []);

  // Filter themes based on query
  const filteredThemes = themes.filter(
    (theme) =>
      theme.name.toLowerCase().includes(query.toLowerCase()) ||
      theme.description?.toLowerCase().includes(query.toLowerCase()),
  );

  // Handle keyboard navigation
  useEffect(() => {
    if (isVisible) {
      setInitialTheme(currentTheme);
      setQuery("");
      setPreviewTheme(null);

      const initialIndex = themes.findIndex((t) => t.id === currentTheme);
      setSelectedIndex(initialIndex >= 0 ? initialIndex : 0);

      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isVisible, themes, currentTheme]);

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
    if (isVisible) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [isVisible, handleKeyDown]);

  // Update selected index when query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Scroll selected item into view
  useEffect(() => {
    const selectedElement = resultsRef.current?.querySelector(`[data-index="${selectedIndex}"]`);
    selectedElement?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedIndex]);

  if (!isVisible) return null;

  const handleClose = () => {
    if (initialTheme) {
      onThemeChange(initialTheme);
    }
    onClose();
  };

  return (
    <Command isVisible={isVisible}>
      <CommandHeader onClose={handleClose}>
        <div className="flex w-full items-center gap-2">
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
                <div className="shrink-0 text-text-lighter">
                  {theme.icon || <Palette size={14} />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 truncate text-xs">
                    <span className="truncate">{theme.name}</span>
                    {isCurrent && !isPreviewing && (
                      <span className="rounded bg-accent/10 px-1 py-0.5 font-medium text-[10px] text-accent">
                        current
                      </span>
                    )}
                  </div>
                </div>
              </CommandItem>
            );
          })
        )}
      </CommandList>
    </Command>
  );
};

IconThemeSelector.displayName = "IconThemeSelector";

export default IconThemeSelector;
