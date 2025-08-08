import { Monitor, Moon, Palette, Sun, Upload } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { themeRegistry } from "@/extensions/themes/theme-registry";
import type { ThemeDefinition } from "@/extensions/themes/types";
import Button from "../../ui/button";
import Command, {
  CommandEmpty,
  CommandHeader,
  CommandInput,
  CommandItem,
  CommandList,
} from "../../ui/command";

interface ThemeInfo {
  id: string;
  name: string;
  description: string;
  category: "System" | "Light" | "Dark" | "Colorful";
  icon?: React.ReactNode;
}

interface ThemeSelectorProps {
  isVisible: boolean;
  onClose: () => void;
  onThemeChange: (theme: string) => void;
  currentTheme?: string;
}

const getThemeIcon = (category: string, _isDark?: boolean): React.ReactNode => {
  switch (category) {
    case "System":
      return <Monitor size={14} />;
    case "Light":
      return <Sun size={14} />;
    case "Dark":
      return <Moon size={14} />;
    default:
      return <Palette size={14} />;
  }
};

const ThemeSelector = ({ isVisible, onClose, onThemeChange, currentTheme }: ThemeSelectorProps) => {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [initialTheme, setInitialTheme] = useState(currentTheme);
  const [previewTheme, setPreviewTheme] = useState<string | null>(null);
  const [themes, setThemes] = useState<ThemeInfo[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  // Load themes from theme registry
  useEffect(() => {
    const loadThemes = () => {
      const registryThemes = themeRegistry.getAllThemes();
      const themeInfos: ThemeInfo[] = [
        // System theme always first
        {
          id: "auto",
          name: "Auto",
          description: "Follow system preference",
          category: "System",
          icon: <Monitor size={14} />,
        },
        // Convert registry themes to ThemeInfo
        ...registryThemes.map(
          (theme: ThemeDefinition): ThemeInfo => ({
            id: theme.id,
            name: theme.name,
            description: theme.description,
            category: theme.category,
            icon: getThemeIcon(theme.category, theme.isDark),
          }),
        ),
      ];
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
      theme.name.toLowerCase().includes(query.toLowerCase()) ||
      theme.description?.toLowerCase().includes(query.toLowerCase()) ||
      theme.category.toLowerCase().includes(query.toLowerCase()),
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

  const handleUploadTheme = async () => {
    // Create file input element
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".toml";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const { uploadTheme } = await import("../../../utils/theme-upload");
        const result = await uploadTheme(file);
        if (result.success) {
          console.log("Theme uploaded successfully:", result.theme?.name);
          // Optionally switch to the newly uploaded theme
          if (result.theme) {
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
            placeholder="Search themes..."
            className="flex-1"
          />
          <Button
            onClick={handleUploadTheme}
            variant="ghost"
            size="xs"
            className="flex-shrink-0 gap-1 px-2"
          >
            <Upload size={12} />
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
                <div className="flex-shrink-0 text-text-lighter">
                  {theme.icon || <Moon size={14} />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 truncate text-xs">
                    <span className="truncate">{theme.name}</span>
                    {isCurrent && !isSelected && (
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

ThemeSelector.displayName = "ThemeSelector";

export default ThemeSelector;
