import { Bot, Monitor, Moon, Palette, Settings, Sun, X } from "lucide-react";
import type React from "react";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { ThemeType } from "../types/theme";

interface Action {
  id: string;
  label: string;
  description?: string;
  icon?: React.ReactNode;
  category: string;
  action: () => void;
}

interface CommandPaletteProps {
  isVisible: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
  onThemeChange: (theme: ThemeType) => void;
  onQuickEditInline?: () => void;
}

export interface CommandPaletteRef {
  focus: () => void;
}

const CommandPalette = forwardRef<CommandPaletteRef, CommandPaletteProps>(
  ({ isVisible, onClose, onOpenSettings, onThemeChange, onQuickEditInline }, ref) => {
    const [query, setQuery] = useState("");
    const [selectedIndex, setSelectedIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const resultsRef = useRef<HTMLDivElement>(null);

    useImperativeHandle(ref, () => ({
      focus: () => {
        if (inputRef.current) {
          inputRef.current.focus();
        }
      },
    }));

    // Theme management
    const setTheme = (
      theme: "auto" | "light" | "dark" | "midnight" | "tokyo-night" | "vesper" | "aura",
    ) => {
      if (onThemeChange) {
        onThemeChange(theme);
      }
      onClose();
    };

    // Define available actions
    const actions: Action[] = [
      {
        id: "ai-quick-edit",
        label: "AI: Quick Edit Selection",
        description: "Edit selected text using AI inline",
        icon: <Bot size={16} />,
        category: "AI",
        action: () => {
          if (onQuickEditInline) onQuickEditInline();
          onClose();
        },
      },
      {
        id: "open-settings",
        label: "Preferences: Open Settings (JSON)",
        description: "Edit settings as JSON file",
        icon: <Settings size={16} />,
        category: "Settings",
        action: () => {
          if (onOpenSettings) {
            onOpenSettings();
          }
          onClose();
        },
      },
      {
        id: "theme-auto",
        label: "Preferences: Color Theme (Auto)",
        description: "Follow system preference",
        icon: <Monitor size={16} />,
        category: "Theme",
        action: () => setTheme("auto"),
      },
      {
        id: "theme-light",
        label: "Preferences: Color Theme (Light)",
        description: "Use light theme",
        icon: <Sun size={16} />,
        category: "Theme",
        action: () => setTheme("light"),
      },
      {
        id: "theme-dark",
        label: "Preferences: Color Theme (Dark)",
        description: "Use dark theme",
        icon: <Moon size={16} />,
        category: "Theme",
        action: () => setTheme("dark"),
      },
      {
        id: "theme-midnight",
        label: "Preferences: Color Theme (Midnight)",
        description: "Pure black with no borders",
        icon: <Moon size={16} />,
        category: "Theme",
        action: () => setTheme("midnight"),
      },
      {
        id: "theme-tokyo-night",
        label: "Preferences: Color Theme (Tokyo Night)",
        description: "Dark theme with vibrant purple and blue tones",
        icon: <Moon size={16} />,
        category: "Theme",
        action: () => setTheme("tokyo-night"),
      },
      {
        id: "theme-vesper",
        label: "Preferences: Color Theme (Vesper)",
        description: "Dark theme with deep blues, purples, and teals",
        icon: <Moon size={16} />,
        category: "Theme",
        action: () => setTheme("vesper"),
      },
      {
        id: "theme-aura",
        label: "Preferences: Color Theme (aura)",
        description: "Dark theme with purple and green",
        icon: <Moon size={16} />,
        category: "Theme",
        action: () => setTheme("aura"),
      },
    ];

    // Filter actions based on query
    const filteredActions = actions.filter(
      action =>
        action.label.toLowerCase().includes(query.toLowerCase()) ||
        action.description?.toLowerCase().includes(query.toLowerCase()) ||
        action.category.toLowerCase().includes(query.toLowerCase()),
    );

    // Handle keyboard navigation
    useEffect(() => {
      if (!isVisible) return;

      const handleKeyDown = (e: KeyboardEvent) => {
        switch (e.key) {
          case "ArrowDown":
            e.preventDefault();
            setSelectedIndex(prev => (prev < filteredActions.length - 1 ? prev + 1 : prev));
            break;
          case "ArrowUp":
            e.preventDefault();
            setSelectedIndex(prev => (prev > 0 ? prev - 1 : prev));
            break;
          case "Enter":
            e.preventDefault();
            if (filteredActions[selectedIndex]) {
              filteredActions[selectedIndex].action();
            }
            break;
          case "Escape":
            e.preventDefault();
            onClose();
            break;
        }
      };

      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }, [isVisible, filteredActions, selectedIndex, onClose]);

    // Reset state when visibility changes
    useEffect(() => {
      if (isVisible) {
        setQuery("");
        setSelectedIndex(0);
        setTimeout(() => {
          if (inputRef.current) {
            inputRef.current.focus();
          }
        }, 100);
      }
    }, [isVisible]);

    // Update selected index when query changes
    useEffect(() => {
      setSelectedIndex(0);
    }, [query]);

    // Scroll selected item into view
    useEffect(() => {
      if (resultsRef.current && filteredActions.length > 0) {
        const selectedElement = resultsRef.current.children[selectedIndex] as HTMLElement;
        if (selectedElement) {
          selectedElement.scrollIntoView({
            block: "nearest",
            behavior: "smooth",
          });
        }
      }
    }, [selectedIndex, filteredActions.length]);

    if (!isVisible) return null;

    return (
      <div className="-translate-x-1/2 fixed top-12 left-1/2 z-[9999] transform">
        <div className="flex max-h-[320px] w-[480px] flex-col overflow-hidden rounded-lg border border-border bg-primary-bg shadow-lg">
          {/* Header */}
          <div className="flex items-center gap-2 border-border border-b px-3 py-2">
            <Palette size={14} className="text-text-lighter" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Type a command..."
              className="flex-1 bg-transparent text-sm text-text placeholder-text-lighter outline-none"
            />
            <button onClick={onClose} className="rounded p-1 transition-colors hover:bg-hover">
              <X size={14} className="text-text-lighter" />
            </button>
          </div>

          {/* Results */}
          <div ref={resultsRef} className="custom-scrollbar-thin flex-1 overflow-y-auto">
            {filteredActions.length === 0 ? (
              <div className="p-4 text-center text-sm text-text-lighter">No commands found</div>
            ) : (
              filteredActions.map((action, index) => (
                <button
                  key={action.id}
                  onClick={e => {
                    e.preventDefault();
                    e.stopPropagation();
                    action.action();
                  }}
                  className={`flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left transition-colors ${
                    index === selectedIndex ? "bg-selected text-text" : "text-text hover:bg-hover"
                  }`}
                >
                  <div className="flex-shrink-0 text-text-lighter">{action.icon}</div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-sm">{action.label}</div>
                    {action.description && (
                      <div className="truncate text-text-lighter text-xs">{action.description}</div>
                    )}
                  </div>
                  <div className="flex-shrink-0 text-text-lighter text-xs uppercase tracking-wide">
                    {action.category}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    );
  },
);

CommandPalette.displayName = "CommandPalette";

export default CommandPalette;
