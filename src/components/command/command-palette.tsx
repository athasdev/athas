import { Palette, Settings, Sparkles } from "lucide-react";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { useAppStore } from "../../stores/app-store";
import { useUIState } from "../../stores/ui-state-store";
import Command, {
  CommandEmpty,
  CommandHeader,
  CommandInput,
  CommandItem,
  CommandList,
} from "../ui/command";
import KeybindingBadge from "../ui/keybinding-badge";

interface Action {
  id: string;
  label: string;
  description?: string;
  icon?: React.ReactNode;
  category: string;
  keybinding?: string[];
  action: () => void;
}

const CommandPalette = () => {
  // Get data from stores
  const {
    isCommandPaletteVisible,
    setIsCommandPaletteVisible,
    setIsSettingsDialogVisible,
    setIsThemeSelectorVisible,
  } = useUIState();
  const { openQuickEdit } = useAppStore.use.actions();

  const isVisible = isCommandPaletteVisible;
  const onClose = () => setIsCommandPaletteVisible(false);
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
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  // Focus is handled internally when the palette becomes visible

  // Define available actions
  const actions: Action[] = [
    {
      id: "ai-quick-edit",
      label: "AI: Quick Edit Selection",
      description: "Edit selected text using AI inline",
      icon: <Sparkles size={14} />,
      category: "AI",
      keybinding: ["⌘", "E"],
      action: () => {
        if (onQuickEditInline) onQuickEditInline();
        onClose();
      },
    },
    {
      id: "open-settings",
      label: "Preferences: Open Settings",
      description: "Open settings dialog",
      icon: <Settings size={14} />,
      category: "Settings",
      keybinding: ["⌘", ","],
      action: () => {
        onClose();
        setIsSettingsDialogVisible(true);
      },
    },
    {
      id: "color-theme",
      label: "Preferences: Color Theme",
      description: "Choose a color theme",
      icon: <Palette size={14} />,
      category: "Theme",
      keybinding: ["⌘", "T"],
      action: () => {
        onClose();
        setIsThemeSelectorVisible(true);
      },
    },
  ];

  // Filter actions based on query
  const filteredActions = actions.filter(
    (action) =>
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
          setSelectedIndex((prev) => (prev < filteredActions.length - 1 ? prev + 1 : prev));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
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
      // Don't reset dialog states - they should persist when command palette closes
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
    <Command isVisible={isVisible}>
      <CommandHeader onClose={onClose}>
        <CommandInput
          ref={inputRef}
          value={query}
          onChange={setQuery}
          placeholder="Type a command..."
        />
      </CommandHeader>

      <CommandList ref={resultsRef}>
        {filteredActions.length === 0 ? (
          <CommandEmpty>No commands found</CommandEmpty>
        ) : (
          filteredActions.map((action, index) => (
            <CommandItem
              key={action.id}
              onClick={() => {
                action.action();
              }}
              isSelected={index === selectedIndex}
              className="px-3 py-1.5"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs">{action.label}</div>
              </div>
              {action.keybinding && (
                <div className="flex-shrink-0">
                  <KeybindingBadge keys={action.keybinding} />
                </div>
              )}
            </CommandItem>
          ))
        )}
      </CommandList>
    </Command>
  );
};

CommandPalette.displayName = "CommandPalette";

export default CommandPalette;
