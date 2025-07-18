import { Bot, Palette, Settings, Terminal, X } from "lucide-react";
import type React from "react";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { cn } from "@/utils/cn";
import { useAppStore } from "../../stores/app-store";
import { useBufferStore } from "../../stores/buffer-store";
import { useEditorConfigStore } from "../../stores/editor-config-store";
import { useSettingsStore } from "../../stores/settings-store";
import { useUIState } from "../../stores/ui-state-store";
import ThemeSelector from "./theme-selector";

interface Action {
  id: string;
  label: string;
  description?: string;
  icon?: React.ReactNode;
  category: string;
  action: () => void;
}

export interface CommandPaletteRef {
  focus: () => void;
}

const CommandPalette = forwardRef<CommandPaletteRef>((_, ref) => {
  // Get data from stores
  const { isCommandPaletteVisible, setIsCommandPaletteVisible } = useUIState();
  const settingsStore = useSettingsStore();
  const { vimEnabled, toggleVim } = useEditorConfigStore();
  const { openBuffer } = useBufferStore();
  const { openQuickEdit } = useAppStore();

  const isVisible = isCommandPaletteVisible;
  const onClose = () => setIsCommandPaletteVisible(false);
  const currentTheme = settingsStore.settings.theme;
  const onThemeChange = settingsStore.updateTheme;
  const onToggleVimMode = toggleVim;
  const onQuickEditInline = () => {
    // TODO: Implement quick edit
    const selection = window.getSelection();
    if (selection?.toString()) {
      openQuickEdit({
        text: selection.toString(),
        cursorPosition: { x: 0, y: 0 },
        selectionRange: { start: 0, end: selection.toString().length },
      });
    }
  };
  const onOpenSettings = () => {
    // Create settings JSON buffer with current values
    const settingsContent = JSON.stringify(
      {
        theme: currentTheme,
        // Add other settings here
      },
      null,
      2,
    );
    openBuffer(
      "settings://user-settings.json",
      "settings.json",
      settingsContent,
      false,
      false,
      false,
      true,
    );
  };
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isThemeSelectorVisible, setIsThemeSelectorVisible] = useState(false);
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
  // @ts-ignore wasn't me
  const _setTheme = (
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
      id: "color-theme",
      label: "Preferences: Color Theme",
      description: "Choose a color theme",
      icon: <Palette size={16} />,
      category: "Theme",
      action: () => {
        console.log("Opening theme selector...");
        setIsThemeSelectorVisible(true);
      },
    },
    {
      id: "toggle-vim-mode",
      label: `Editor: ${vimEnabled ? "Disable" : "Enable"} Vim Mode`,
      description: `${vimEnabled ? "Turn off" : "Turn on"} Vim key bindings`,
      icon: <Terminal size={16} />,
      category: "Editor",
      action: () => {
        if (onToggleVimMode) {
          onToggleVimMode();
        }
        onClose();
      },
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
      setIsThemeSelectorVisible(false);
      // Immediate focus without delay for better UX
      requestAnimationFrame(() => {
        if (inputRef.current) {
          inputRef.current.focus();
        }
      });
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
    <>
      <div className="-translate-x-1/2 fixed top-12 left-1/2 z-[9999] transform">
        <div className="flex max-h-[400px] w-[600px] flex-col overflow-hidden rounded-lg border border-border bg-primary-bg shadow-2xl">
          {/* Header */}
          <div className="flex items-center gap-3 border-border border-b px-4 py-3">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Type a command..."
              className={cn(
                "flex-1 border-none bg-transparent text-sm text-text",
                "placeholder-text-lighter outline-none",
                "focus:border-none focus:shadow-none focus:outline-none focus:ring-0",
              )}
              style={{
                outline: "none !important",
                boxShadow: "none !important",
                border: "none !important",
                WebkitAppearance: "none",
              }}
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
                  className={cn(
                    "flex w-full cursor-pointer items-center px-4 py-1.5 text-left transition-colors",
                    index === selectedIndex ? "bg-selected text-text" : "text-text hover:bg-hover",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{action.label}</div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Theme Selector */}
      <ThemeSelector
        isVisible={isThemeSelectorVisible}
        onClose={() => setIsThemeSelectorVisible(false)}
        onThemeChange={onThemeChange}
        currentTheme={currentTheme}
      />
    </>
  );
});

CommandPalette.displayName = "CommandPalette";

export default CommandPalette;
