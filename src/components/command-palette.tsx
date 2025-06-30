import React, { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { X, Palette, Monitor, Sun, Moon, Settings } from 'lucide-react';

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
}

// Add the ThemeType definition
type ThemeType = 'auto' | 'light' | 'dark' | 'midnight' | 
  'catppuccin-mocha' | 'catppuccin-macchiato' | 'catppuccin-frappe' | 'catppuccin-latte' |
  'tokyo-night' | 'tokyo-night-storm' | 'tokyo-night-light' |
  'dracula' | 'dracula-soft' |
  'nord' | 'nord-light' |
  'github-dark' | 'github-dark-dimmed' | 'github-light' |
  'one-dark-pro' | 'one-light-pro' |
  'material-deep-ocean' | 'material-palenight' | 'material-lighter' |
  'gruvbox-dark' | 'gruvbox-light' |
  'solarized-dark' | 'solarized-light' |
  'synthwave-84' |
  'monokai-pro' |
  'ayu-dark' | 'ayu-mirage' | 'ayu-light';

export interface CommandPaletteRef {
  focus: () => void;
}

const CommandPalette = forwardRef<CommandPaletteRef, CommandPaletteProps>(
  ({ isVisible, onClose, onOpenSettings, onThemeChange }, ref) => {
    const [query, setQuery] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const resultsRef = useRef<HTMLDivElement>(null);

    useImperativeHandle(ref, () => ({
      focus: () => {
        if (inputRef.current) {
          inputRef.current.focus();
        }
      }
    }));

    // Define available actions
    const actions: Action[] = [
      {
        id: 'open-settings',
        label: 'Preferences: Open Settings (JSON)',
        description: 'Edit settings as JSON file',
        icon: <Settings size={16} />,
        category: 'Settings',
        action: () => {
          if (onOpenSettings) {
            onOpenSettings();
          }
          onClose();
        }
      },
      {
        id: 'theme-auto',
        label: 'Preferences: Color Theme (Auto)',
        description: 'Follow system preference',
        icon: <Monitor size={16} />,
        category: 'Theme',
        action: () => setTheme('auto')
      },
      {
        id: 'theme-light',
        label: 'Preferences: Color Theme (Light)',
        description: 'Use light theme',
        icon: <Sun size={16} />,
        category: 'Theme',
        action: () => setTheme('light')
      },
      {
        id: 'theme-dark',
        label: 'Preferences: Color Theme (Dark)',
        description: 'Use dark theme',
        icon: <Moon size={16} />,
        category: 'Theme',
        action: () => setTheme('dark')
      },
      {
        id: 'theme-midnight',
        label: 'Preferences: Color Theme (Midnight)',
        description: 'Pure black with no borders',
        icon: <Moon size={16} />,
        category: 'Theme',
        action: () => setTheme('midnight')
      },
      {
        id: 'theme-tokyo-night',
        label: 'Preferences: Color Theme (Tokyo Night)',
        description: 'Dark theme with vibrant purple and blue tones',
        icon: <Moon size={16} />,
        category: 'Theme',
        action: () => setTheme('tokyo-night')
      }
    ];

    // Filter actions based on query
    const filteredActions = actions.filter(action =>
      action.label.toLowerCase().includes(query.toLowerCase()) ||
      action.description?.toLowerCase().includes(query.toLowerCase()) ||
      action.category.toLowerCase().includes(query.toLowerCase())
    );



    // Theme management
    const setTheme = (theme: 'auto' | 'light' | 'dark' | 'midnight' | 'tokyo-night') => {
      if (onThemeChange) {
        onThemeChange(theme);
      }
      onClose();
    };

    // Handle keyboard navigation
    useEffect(() => {
      if (!isVisible) return;

      const handleKeyDown = (e: KeyboardEvent) => {
        switch (e.key) {
          case 'ArrowDown':
            e.preventDefault();
            setSelectedIndex(prev => 
              prev < filteredActions.length - 1 ? prev + 1 : prev
            );
            break;
          case 'ArrowUp':
            e.preventDefault();
            setSelectedIndex(prev => prev > 0 ? prev - 1 : prev);
            break;
          case 'Enter':
            e.preventDefault();
            if (filteredActions[selectedIndex]) {
              filteredActions[selectedIndex].action();
            }
            break;
          case 'Escape':
            e.preventDefault();
            onClose();
            break;
        }
      };

      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isVisible, filteredActions, selectedIndex, onClose]);

    // Reset state when visibility changes
    useEffect(() => {
      if (isVisible) {
        setQuery('');
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
            block: 'nearest',
            behavior: 'smooth'
          });
        }
      }
    }, [selectedIndex, filteredActions.length]);

    if (!isVisible) return null;

    return (
      <div className="fixed top-12 left-1/2 transform -translate-x-1/2 z-[9999]">
        <div className="bg-[var(--primary-bg)] border border-[var(--border-color)] rounded-lg shadow-lg w-[480px] max-h-[320px] flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border-color)]">
            <Palette size={14} className="text-[var(--text-lighter)]" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type a command..."
              className="flex-1 bg-transparent text-[var(--text-color)] placeholder-[var(--text-lighter)] outline-none text-sm"
            />
            <button
              onClick={onClose}
              className="p-1 hover:bg-[var(--hover-color)] rounded transition-colors"
            >
              <X size={14} className="text-[var(--text-lighter)]" />
            </button>
          </div>

          {/* Results */}
          <div
            ref={resultsRef}
            className="flex-1 overflow-y-auto custom-scrollbar-thin"
          >
            {filteredActions.length === 0 ? (
              <div className="p-4 text-center text-[var(--text-lighter)] text-sm">
                No commands found
              </div>
            ) : (
              filteredActions.map((action, index) => (
                <button
                  key={action.id}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    action.action();
                  }}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors cursor-pointer ${
                    index === selectedIndex
                      ? 'bg-[var(--selected-color)] text-[var(--text-color)]'
                      : 'hover:bg-[var(--hover-color)] text-[var(--text-color)]'
                  }`}
                >
                  <div className="text-[var(--text-lighter)] flex-shrink-0">
                    {action.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">
                      {action.label}
                    </div>
                    {action.description && (
                      <div className="text-xs text-[var(--text-lighter)] truncate">
                        {action.description}
                      </div>
                    )}
                  </div>
                  <div className="text-xs text-[var(--text-lighter)] uppercase tracking-wide flex-shrink-0">
                    {action.category}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    );
  }
);

CommandPalette.displayName = 'CommandPalette';

export default CommandPalette; 