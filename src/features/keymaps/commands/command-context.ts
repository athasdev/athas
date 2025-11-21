/**
 * Command context - provides access to app state and callbacks
 * Commands register themselves with this context at runtime
 */

interface CommandCallbacks {
  // File operations
  closeBuffer?: (bufferId: string) => void;
  reopenClosedTab?: () => Promise<void>;
  activeBuffer?: { id: string } | null;

  // Navigation
  switchToNextBuffer?: () => void;
  switchToPreviousBuffer?: () => void;
  setActiveBuffer?: (bufferId: string) => void;
  buffers?: Array<{ id: string }>;

  // View toggles
  setIsBottomPaneVisible?: (value: boolean | ((prev: boolean) => boolean)) => void;
  setBottomPaneActiveTab?: (tab: "terminal" | "diagnostics") => void;
  setIsFindVisible?: (value: boolean | ((prev: boolean) => boolean)) => void;
  setIsSidebarVisible?: (value: boolean | ((prev: boolean) => boolean)) => void;
  setIsCommandPaletteVisible?: (value: boolean | ((prev: boolean) => boolean)) => void;
  setIsGlobalSearchVisible?: (value: boolean | ((prev: boolean) => boolean)) => void;
  setIsThemeSelectorVisible?: (value: boolean | ((prev: boolean) => boolean)) => void;
  setIsSearchViewActive?: (value: boolean) => void;
  focusSearchInput?: () => void;
  onToggleSidebarPosition?: () => void;
  isBottomPaneVisible?: boolean;
  bottomPaneActiveTab?: "terminal" | "diagnostics";

  // Zoom
  zoomIn?: () => void;
  zoomOut?: () => void;
  resetZoom?: () => void;
}

class CommandContext {
  private callbacks: CommandCallbacks = {};

  setCallbacks(callbacks: CommandCallbacks) {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  getCallbacks(): CommandCallbacks {
    return this.callbacks;
  }

  get<K extends keyof CommandCallbacks>(key: K): CommandCallbacks[K] {
    return this.callbacks[key];
  }
}

export const commandContext = new CommandContext();
