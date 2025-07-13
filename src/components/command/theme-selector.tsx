import { Monitor, Moon, Sun, X } from "lucide-react";
import type React from "react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { ThemeType } from "../../types/theme";

interface ThemeInfo {
  id: ThemeType;
  name: string;
  description: string;
  category: "System" | "Light" | "Dark" | "Colorful";
  icon?: React.ReactNode;
}

interface ThemeSelectorProps {
  isVisible: boolean;
  onClose: () => void;
  onThemeChange: (theme: ThemeType) => void;
  currentTheme?: ThemeType;
}

export interface ThemeSelectorRef {
  focus: () => void;
}

// Dynamic theme definitions based on existing theme system
const THEME_DEFINITIONS: ThemeInfo[] = [
  // System
  {
    id: "auto",
    name: "Auto",
    description: "Follow system preference",
    category: "System",
    icon: <Monitor size={16} />,
  },

  // Light themes
  {
    id: "light",
    name: "Light",
    description: "Classic light theme",
    category: "Light",
    icon: <Sun size={16} />,
  },
  {
    id: "catppuccin-latte",
    name: "Catppuccin Latte",
    description: "Warm light theme with pastel colors",
    category: "Light",
  },
  {
    id: "tokyo-night-light",
    name: "Tokyo Night Light",
    description: "Light version of Tokyo Night",
    category: "Light",
  },
  {
    id: "nord-light",
    name: "Nord Light",
    description: "Arctic light theme",
    category: "Light",
  },
  {
    id: "github-light",
    name: "GitHub Light",
    description: "GitHub's light theme",
    category: "Light",
  },
  {
    id: "one-light-pro",
    name: "One Light Pro",
    description: "Atom's One Light theme",
    category: "Light",
  },
  {
    id: "material-lighter",
    name: "Material Lighter",
    description: "Google's Material Design light",
    category: "Light",
  },
  {
    id: "gruvbox-light",
    name: "Gruvbox Light",
    description: "Retro groove light colors",
    category: "Light",
  },
  {
    id: "solarized-light",
    name: "Solarized Light",
    description: "Precision colors for machines and people",
    category: "Light",
  },
  {
    id: "ayu-light",
    name: "Ayu Light",
    description: "Simple, bright theme",
    category: "Light",
  },

  // Dark themes
  {
    id: "dark",
    name: "Dark",
    description: "Classic dark theme",
    category: "Dark",
    icon: <Moon size={16} />,
  },
  {
    id: "midnight",
    name: "Midnight",
    description: "Pure black with no borders",
    category: "Dark",
    icon: <Moon size={16} />,
  },
  {
    id: "catppuccin-mocha",
    name: "Catppuccin Mocha",
    description: "Warm dark theme with vibrant colors",
    category: "Dark",
  },
  {
    id: "catppuccin-macchiato",
    name: "Catppuccin Macchiato",
    description: "Medium dark theme",
    category: "Dark",
  },
  {
    id: "catppuccin-frappe",
    name: "Catppuccin Frappé",
    description: "Cool dark theme",
    category: "Dark",
  },
  {
    id: "nord",
    name: "Nord",
    description: "Arctic, north-bluish color palette",
    category: "Dark",
  },
  {
    id: "github-dark",
    name: "GitHub Dark",
    description: "GitHub's dark theme",
    category: "Dark",
  },
  {
    id: "github-dark-dimmed",
    name: "GitHub Dark Dimmed",
    description: "GitHub's dimmed dark theme",
    category: "Dark",
  },
  {
    id: "one-dark-pro",
    name: "One Dark Pro",
    description: "Atom's One Dark theme",
    category: "Dark",
  },
  {
    id: "material-deep-ocean",
    name: "Material Deep Ocean",
    description: "Deep ocean material theme",
    category: "Dark",
  },
  {
    id: "material-palenight",
    name: "Material Palenight",
    description: "Elegant material dark theme",
    category: "Dark",
  },
  {
    id: "gruvbox-dark",
    name: "Gruvbox Dark",
    description: "Retro groove dark colors",
    category: "Dark",
  },
  {
    id: "solarized-dark",
    name: "Solarized Dark",
    description: "Precision dark colors",
    category: "Dark",
  },
  {
    id: "monokai-pro",
    name: "Monokai Pro",
    description: "Professional Monokai",
    category: "Dark",
  },
  {
    id: "ayu-dark",
    name: "Ayu Dark",
    description: "Simple, elegant dark theme",
    category: "Dark",
  },
  {
    id: "ayu-mirage",
    name: "Ayu Mirage",
    description: "Medium contrast Ayu theme",
    category: "Dark",
  },
  {
    id: "vercel-dark",
    name: "Vercel Dark",
    description: "Vercel's dark theme",
    category: "Dark",
  },
  {
    id: "vesper",
    name: "Vesper",
    description: "Dark theme with deep blues and purples",
    category: "Dark",
  },

  // Colorful themes
  {
    id: "tokyo-night",
    name: "Tokyo Night",
    description: "Dark theme with vibrant colors",
    category: "Colorful",
  },
  {
    id: "tokyo-night-storm",
    name: "Tokyo Night Storm",
    description: "Stormy variant of Tokyo Night",
    category: "Colorful",
  },
  {
    id: "dracula",
    name: "Dracula",
    description: "Dark theme with purple accents",
    category: "Colorful",
  },
  {
    id: "dracula-soft",
    name: "Dracula Soft",
    description: "Softer variant of Dracula",
    category: "Colorful",
  },
  {
    id: "synthwave-84",
    name: "SynthWave '84",
    description: "Retro cyberpunk theme",
    category: "Colorful",
  },
  {
    id: "aura",
    name: "Aura",
    description: "Dark theme with purple and green",
    category: "Colorful",
  },
];

const ThemeSelector = forwardRef<ThemeSelectorRef, ThemeSelectorProps>(
  ({ isVisible, onClose, onThemeChange, currentTheme }, ref) => {
    const [query, setQuery] = useState("");
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [initialTheme, setInitialTheme] = useState(currentTheme);
    const inputRef = useRef<HTMLInputElement>(null);
    const resultsRef = useRef<HTMLDivElement>(null);

    useImperativeHandle(ref, () => ({
      focus: () => inputRef.current?.focus(),
    }));

    // Filter themes based on query
    const filteredThemes = THEME_DEFINITIONS.filter(
      theme =>
        theme.name.toLowerCase().includes(query.toLowerCase()) ||
        theme.description?.toLowerCase().includes(query.toLowerCase()) ||
        theme.category.toLowerCase().includes(query.toLowerCase()),
    );

    // Group themes by category
    const groupedThemes = filteredThemes.reduce(
      (acc, theme) => {
        if (!acc[theme.category]) {
          acc[theme.category] = [];
        }
        acc[theme.category].push(theme);
        return acc;
      },
      {} as Record<string, ThemeInfo[]>,
    );

    // Handle keyboard navigation
    useEffect(() => {
      if (isVisible) {
        setInitialTheme(currentTheme);
        setQuery("");

        const initialIndex = THEME_DEFINITIONS.findIndex(t => t.id === currentTheme);
        setSelectedIndex(initialIndex >= 0 ? initialIndex : 0);

        requestAnimationFrame(() => inputRef.current?.focus());
      }
    }, [isVisible]);

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
          onThemeChange(initialTheme!);
          onClose();
          return;
        }

        if (nextIndex !== selectedIndex) {
          setSelectedIndex(nextIndex);
          onThemeChange(filteredThemes[nextIndex].id);
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
      onThemeChange(initialTheme!);
      onClose();
    };

    return (
      <div className="-translate-x-1/2 fixed top-12 left-1/2 z-[9999] transform">
        <div className="flex max-h-[500px] w-[600px] flex-col overflow-hidden rounded-lg border border-border bg-primary-bg shadow-lg">
          {/* Header */}
          <div className="flex items-center gap-2 border-border border-b px-4 py-3">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search themes..."
              className="flex-1 bg-transparent text-sm text-text placeholder-text-lighter outline-none"
            />
            <button onClick={handleClose} className="rounded p-1 transition-colors hover:bg-hover">
              <X size={14} className="text-text-lighter" />
            </button>
          </div>

          {/* Results */}
          <div ref={resultsRef} className="custom-scrollbar-thin flex-1 overflow-y-auto">
            {filteredThemes.length === 0 ? (
              <div className="p-4 text-center text-sm text-text-lighter">No themes found</div>
            ) : (
              <div className="p-2">
                {Object.entries(groupedThemes).map(([category, themes]) => (
                  <div key={category} className="mb-4 last:mb-0">
                    <div className="mb-2 px-2 font-medium text-text-lighter text-xs uppercase tracking-wide">
                      {category}
                    </div>
                    {themes.map(theme => {
                      const globalIndex = filteredThemes.indexOf(theme);
                      const isSelected = globalIndex === selectedIndex;
                      const isCurrent = theme.id === initialTheme;

                      return (
                        <button
                          key={theme.id}
                          data-index={globalIndex}
                          onClick={() => {
                            onThemeChange(theme.id);
                            onClose();
                          }}
                          onMouseEnter={() => {
                            setSelectedIndex(globalIndex);
                            onThemeChange(theme.id);
                          }}
                          className={`flex w-full cursor-pointer items-center gap-3 rounded px-3 py-1.5 text-left transition-colors ${
                            isSelected ? "bg-selected text-text" : "text-text hover:bg-hover"
                          }`}
                        >
                          <div className="flex-shrink-0 text-text-lighter">
                            {theme.icon || <Moon size={16} />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-sm">{theme.name}</span>
                              {isCurrent && !isSelected && (
                                <span className="rounded bg-accent/10 px-1.5 py-0.5 text-accent text-xs">
                                  current
                                </span>
                              )}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  },
);

ThemeSelector.displayName = "ThemeSelector";

export default ThemeSelector;
