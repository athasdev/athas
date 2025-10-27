import { exit } from "@tauri-apps/plugin-process";
import React, { useEffect } from "react";
import { useSettingsStore } from "@/settings/store";
import { useUIState } from "@/stores/ui-state-store";
import { isMac } from "../file-system/controllers/platform";
import type { CoreFeaturesState } from "../settings/models/feature.types";
import { useZoomStore } from "../stores/zoom-store";
import type { Buffer } from "../types/buffer";

//import { useActiveElement } from "./use-active-dom-element";

interface UseKeyboardShortcutsProps {
  setIsBottomPaneVisible: (value: boolean | ((prev: boolean) => boolean)) => void;
  setBottomPaneActiveTab: (tab: "terminal" | "diagnostics") => void;
  setIsFindVisible: (value: boolean | ((prev: boolean) => boolean)) => void;
  setIsSidebarVisible: (value: boolean | ((prev: boolean) => boolean)) => void;
  setIsRightPaneVisible: (value: boolean | ((prev: boolean) => boolean)) => void;
  setIsCommandBarVisible: (value: boolean | ((prev: boolean) => boolean)) => void;
  setIsCommandPaletteVisible: (value: boolean | ((prev: boolean) => boolean)) => void;
  setIsGlobalSearchVisible: (value: boolean | ((prev: boolean) => boolean)) => void;
  setIsThemeSelectorVisible: (value: boolean | ((prev: boolean) => boolean)) => void;
  setIsSearchViewActive: (value: boolean) => void;
  focusSearchInput: () => void;
  focusCommandPalette: () => void;
  focusTerminal?: () => void;
  requestTerminalFocus?: () => void;
  activeBuffer: Buffer | null;
  closeBuffer: (bufferId: string) => void;
  switchToNextBuffer: () => void;
  switchToPreviousBuffer: () => void;
  buffers: Buffer[];
  setActiveBuffer: (bufferId: string) => void;
  reopenClosedTab: () => Promise<void>;
  isBottomPaneVisible: boolean;
  bottomPaneActiveTab: "terminal" | "diagnostics";
  onSave?: () => void;
  onQuickEdit?: () => void;
  onToggleSidebarPosition?: () => void;
  coreFeatures: CoreFeaturesState;
}

export const useKeyboardShortcuts = ({
  setIsBottomPaneVisible,
  setBottomPaneActiveTab,
  setIsFindVisible,
  setIsSidebarVisible,
  setIsRightPaneVisible,
  setIsCommandBarVisible,
  setIsCommandPaletteVisible,
  setIsGlobalSearchVisible,
  setIsThemeSelectorVisible,
  setIsSearchViewActive,
  focusSearchInput,
  focusCommandPalette,
  focusTerminal,
  requestTerminalFocus,
  activeBuffer,
  closeBuffer,
  switchToNextBuffer,
  switchToPreviousBuffer,
  buffers,
  setActiveBuffer,
  reopenClosedTab,
  isBottomPaneVisible,
  bottomPaneActiveTab,
  onSave,
  onQuickEdit,
  onToggleSidebarPosition,
  coreFeatures,
}: UseKeyboardShortcutsProps) => {
  const { settings } = useSettingsStore();
  const { zoomIn, zoomOut, resetZoom } = useZoomStore.use.actions();

  // const activeElement = useActiveElement();

  // Track Cmd+K chord
  const [isAwaitingChord, setIsAwaitingChord] = React.useState(false);
  const chordTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Global Escape handler - close top modal first
      if (e.key === "Escape") {
        const { hasOpenModal, closeTopModal } = useUIState.getState();
        if (hasOpenModal()) {
          e.preventDefault();
          e.stopPropagation();
          closeTopModal();
          return;
        }
      }

      // Don't process regular shortcuts if vim mode is enabled and we're not using modifier keys
      const isVimModeEnabled = settings.vimMode;
      const hasModifiers = e.metaKey || e.ctrlKey || e.altKey || e.shiftKey;

      if (isVimModeEnabled && !hasModifiers) {
        // Let vim mode handle basic keys without modifiers
        return;
      }

      // Handle Cmd+K chord sequence
      if ((e.metaKey || e.ctrlKey) && e.key === "k" && !e.shiftKey && !isAwaitingChord) {
        e.preventDefault();
        setIsAwaitingChord(true);

        // Clear any existing timeout
        if (chordTimeoutRef.current) {
          clearTimeout(chordTimeoutRef.current);
        }

        // Reset chord state after 1 second
        chordTimeoutRef.current = setTimeout(() => {
          setIsAwaitingChord(false);
        }, 1000);

        return;
      }

      // Handle 'T' after Cmd+K to open theme selector
      if (isAwaitingChord && (e.key === "t" || e.key === "T")) {
        e.preventDefault();
        setIsAwaitingChord(false);
        if (chordTimeoutRef.current) {
          clearTimeout(chordTimeoutRef.current);
        }
        setIsThemeSelectorVisible(true);
        return;
      }

      // Cancel chord on any other key (except modifier keys)
      if (isAwaitingChord && !["Meta", "Control", "Alt", "Shift"].includes(e.key)) {
        setIsAwaitingChord(false);
        if (chordTimeoutRef.current) {
          clearTimeout(chordTimeoutRef.current);
        }
      }

      // Terminal toggle with Ctrl/Cmd + ` (backtick)
      if ((e.metaKey || e.ctrlKey) && e.key === "`" && coreFeatures.terminal) {
        e.preventDefault();
        if (isBottomPaneVisible && bottomPaneActiveTab === "terminal") {
          setIsBottomPaneVisible(false);
        } else {
          setBottomPaneActiveTab("terminal");
          setIsBottomPaneVisible(true);
          // Request terminal focus through UI state
          setTimeout(() => {
            if (requestTerminalFocus) {
              requestTerminalFocus();
            } else if (focusTerminal) {
              focusTerminal();
            }
          }, 100);
        }
        return;
      }

      // Keep the old shortcut for backwards compatibility
      if ((e.metaKey || e.ctrlKey) && e.key === "j" && coreFeatures.terminal && !isMac()) {
        e.preventDefault();
        if (isBottomPaneVisible && bottomPaneActiveTab === "terminal") {
          setIsBottomPaneVisible(false);
        } else {
          setBottomPaneActiveTab("terminal");
          setIsBottomPaneVisible(true);
          // Request terminal focus through UI state
          setTimeout(() => {
            if (requestTerminalFocus) {
              requestTerminalFocus();
            } else if (focusTerminal) {
              focusTerminal();
            }
          }, 100);
        }
        return;
      }

      // Cmd+Shift+J (Mac) or Ctrl+Shift+J (Windows/Linux) to toggle diagnostics
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "J" && coreFeatures.diagnostics) {
        e.preventDefault();
        if (isBottomPaneVisible && bottomPaneActiveTab === "diagnostics") {
          setIsBottomPaneVisible(false);
        } else {
          setBottomPaneActiveTab("diagnostics");
          setIsBottomPaneVisible(true);
        }
        return;
      }

      // Handle save on all platforms (with fallback for macOS if native menu fails)
      if ((e.metaKey || e.ctrlKey) && e.key === "s" && !e.shiftKey) {
        e.preventDefault();
        if (onSave) {
          onSave();
        }
        return;
      }

      // Find is now handled by native menu accelerator on macOS
      // Only handle on non-macOS platforms
      if ((e.metaKey || e.ctrlKey) && e.key === "f" && !e.shiftKey && !isMac()) {
        e.preventDefault();
        setIsFindVisible((prev) => !prev);
        return;
      }

      // Global Search (Ctrl+Shift+F / Cmd+Shift+F)
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "F" || e.key === "f")) {
        e.preventDefault();
        setIsGlobalSearchVisible((prev) => !prev);
        return;
      }

      // Sidebar Search (Cmd+Shift+H / Ctrl+Shift+H) - opens project search in sidebar
      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        (e.key === "H" || e.key === "h") &&
        coreFeatures.search
      ) {
        e.preventDefault();
        e.stopPropagation();
        setIsSidebarVisible(true);
        setIsSearchViewActive(true);
        setTimeout(() => {
          focusSearchInput();
        }, 100);
        return;
      }

      // Sidebar toggle is now handled by native menu accelerator on macOS
      // Only handle on non-macOS platforms
      if ((e.metaKey || e.ctrlKey) && e.key === "b" && !e.shiftKey && !isMac()) {
        e.preventDefault();
        setIsSidebarVisible((prev) => !prev);
        return;
      }

      // Cmd+Shift+B (Mac) or Ctrl+Shift+B (Windows/Linux) to toggle sidebar position
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "B") {
        e.preventDefault();
        if (onToggleSidebarPosition) {
          onToggleSidebarPosition();
        }
        return;
      }

      // AI Chat toggle is now handled by native menu accelerator on macOS
      // Only handle on non-macOS platforms
      if ((e.metaKey || e.ctrlKey) && e.key === "r" && coreFeatures.aiChat && !isMac()) {
        e.preventDefault();
        setIsRightPaneVisible((prev) => !prev);
        return;
      }

      // Go to File (Ctrl+P / Cmd+P)
      if ((e.metaKey || e.ctrlKey) && e.key === "p" && !e.shiftKey) {
        e.preventDefault();
        setIsCommandBarVisible((prev) => !prev);
        return;
      }

      // Command Palette (Ctrl+Shift+P / Cmd+Shift+P)
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "P") {
        e.preventDefault();
        setIsCommandPaletteVisible((prev) => !prev);
        return;
      }

      // Go to Line (Ctrl+G / Cmd+G)
      if ((e.metaKey || e.ctrlKey) && e.key === "g") {
        e.preventDefault();
        // Dispatch custom event for Go to Line
        window.dispatchEvent(new CustomEvent("menu-go-to-line"));
        return;
      }

      // Find and Replace (Ctrl+H / Cmd+Alt+F)
      if (
        ((e.ctrlKey && e.key === "h") || (e.metaKey && e.altKey && e.key === "f")) &&
        coreFeatures.search
      ) {
        e.preventDefault();
        setIsFindVisible(true);
        console.log("Find/Replace mode activated");
        return;
      }

      // Save As (Ctrl+Shift+S / Cmd+Shift+S)
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "S") {
        e.preventDefault();
        console.log("Save As triggered via keyboard shortcut");
        // Dispatch custom event for Save As
        window.dispatchEvent(new CustomEvent("menu-save-as"));
        return;
      }

      // Undo (Ctrl+Z / Cmd+Z)
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        document.execCommand("undo");
        return;
      }

      // Redo (Ctrl+Y / Cmd+Y or Ctrl+Shift+Z / Cmd+Shift+Z)
      if (
        ((e.metaKey || e.ctrlKey) && e.key === "y") ||
        ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "Z")
      ) {
        e.preventDefault();
        document.execCommand("redo");
        return;
      }

      // Close Tab (Ctrl+W / Cmd+W)
      if ((e.metaKey || e.ctrlKey) && e.key === "w" && !e.shiftKey) {
        e.preventDefault();
        if (activeBuffer) {
          closeBuffer(activeBuffer.id);
        }
        return;
      }

      // Reopen Closed Tab (Ctrl+Shift+T / Cmd+Shift+T)
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "T" || e.key === "t")) {
        e.preventDefault();
        reopenClosedTab();
        return;
      }

      // Handle tab navigation on all platforms (Ctrl+Tab for next tab)
      if (e.ctrlKey && e.key === "Tab" && !e.shiftKey) {
        e.preventDefault();
        switchToNextBuffer();
        return;
      }

      // Handle tab navigation on all platforms (Ctrl+Shift+Tab for previous tab)
      if (e.ctrlKey && e.shiftKey && e.key === "Tab") {
        e.preventDefault();
        switchToPreviousBuffer();
        return;
      }

      // Tab navigation with Ctrl+PageDown (next tab)
      if (e.ctrlKey && e.key === "PageDown" && !e.shiftKey) {
        e.preventDefault();
        switchToNextBuffer();
        return;
      }

      // Tab navigation with Ctrl+PageUp (previous tab)
      if (e.ctrlKey && e.key === "PageUp" && !e.shiftKey) {
        e.preventDefault();
        switchToPreviousBuffer();
        return;
      }

      // Number keys to switch to specific buffers (Cmd+1, Cmd+2, etc.)
      if ((e.metaKey || e.ctrlKey) && /^[1-9]$/.test(e.key)) {
        e.preventDefault();
        const bufferIndex = parseInt(e.key) - 1;
        if (buffers[bufferIndex]) {
          setActiveBuffer(buffers[bufferIndex].id);
        }
        return;
      }

      // Cmd+M (Mac) to minimize window (native macOS behavior)
      if (e.metaKey && e.key === "m" && isMac()) {
        e.preventDefault();
        // Let the system handle window minimization
        return;
      }

      // Cmd+H (Mac) to hide application (native macOS behavior)
      if (e.metaKey && e.key === "h" && isMac()) {
        e.preventDefault();
        // Let the system handle app hiding
        return;
      }

      // Cmd+Option+H (Mac) to hide other applications (native macOS behavior)
      if (e.metaKey && e.altKey && e.key === "h" && isMac()) {
        e.preventDefault();
        // Let the system handle hiding other apps
        return;
      }

      // Cmd+Q (Mac) to quit application
      if (e.metaKey && e.key === "q" && isMac()) {
        e.preventDefault();
        exit(0);
        return;
      }

      // Zoom controls
      if ((e.metaKey || e.ctrlKey) && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        const terminalContainer = document.querySelector('[data-terminal-container="active"]');
        const isTerminalFocused = terminalContainer?.contains(document.activeElement);
        if (isTerminalFocused) {
          zoomIn("terminal");
        } else {
          zoomIn("window");
        }
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key === "-") {
        e.preventDefault();
        const terminalContainer = document.querySelector('[data-terminal-container="active"]');
        const isTerminalFocused = terminalContainer?.contains(document.activeElement);
        if (isTerminalFocused) {
          zoomOut("terminal");
        } else {
          zoomOut("window");
        }
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key === "0") {
        e.preventDefault();
        const terminalContainer = document.querySelector('[data-terminal-container="active"]');
        const isTerminalFocused = terminalContainer?.contains(document.activeElement);
        if (isTerminalFocused) {
          resetZoom("terminal");
        } else {
          resetZoom("window");
        }
        return;
      }

      // Menu bar toggle: Alt+M (Linux/Windows)
      if (e.altKey && e.key === "m" && !isMac() && settings.nativeMenuBar) {
        e.preventDefault();
        console.log("Toggle menu bar shortcut activated");
        // Call the Tauri command directly to toggle menu bar
        import("@tauri-apps/api/core").then(({ invoke }) => {
          invoke("toggle_menu_bar").catch((error) => {
            console.error("Failed to toggle menu bar via shortcut:", error);
          });
        });
        return;
      }

      // Window controls for Linux/Windows
      if (!isMac()) {
        // Minimize: Alt+F9
        if (e.altKey && e.key === "F9") {
          e.preventDefault();
          console.log("Minimize window shortcut activated");
          window.dispatchEvent(new CustomEvent("minimize-window"));
          return;
        }

        // Maximize/Restore: Alt+F10
        if (e.altKey && e.key === "F10") {
          e.preventDefault();
          console.log("Maximize window shortcut activated");
          window.dispatchEvent(new CustomEvent("maximize-window"));
          return;
        }
      }

      // Fullscreen toggle: F11 (all platforms)
      if (e.key === "F11") {
        e.preventDefault();
        console.log("Toggle fullscreen shortcut activated");
        window.dispatchEvent(new CustomEvent("toggle-fullscreen"));
        return;
      }

      // macOS specific window shortcuts
      if (isMac()) {
        // Minimize: Cmd+M
        if (e.metaKey && e.key === "m") {
          e.preventDefault();
          console.log("Minimize window (macOS)");
          window.dispatchEvent(new CustomEvent("minimize-window"));
          return;
        }

        // Fullscreen: Cmd+Ctrl+F
        if (e.metaKey && e.ctrlKey && e.key === "f") {
          e.preventDefault();
          console.log("Toggle fullscreen (macOS)");
          window.dispatchEvent(new CustomEvent("toggle-fullscreen"));
          return;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      // Clean up chord timeout on unmount
      if (chordTimeoutRef.current) {
        clearTimeout(chordTimeoutRef.current);
      }
    };
  }, [
    setIsBottomPaneVisible,
    setBottomPaneActiveTab,
    setIsFindVisible,
    setIsSidebarVisible,
    setIsRightPaneVisible,
    setIsCommandBarVisible,
    setIsCommandPaletteVisible,
    setIsGlobalSearchVisible,
    setIsThemeSelectorVisible,
    setIsSearchViewActive,
    focusSearchInput,
    focusCommandPalette,
    activeBuffer,
    closeBuffer,
    switchToNextBuffer,
    switchToPreviousBuffer,
    buffers,
    setActiveBuffer,
    isBottomPaneVisible,
    bottomPaneActiveTab,
    onSave,
    onQuickEdit,
    onToggleSidebarPosition,
    coreFeatures,
    focusTerminal,
    requestTerminalFocus,
    settings.vimMode,
    settings.nativeMenuBar,
    zoomIn,
    zoomOut,
    resetZoom,
    isAwaitingChord,
  ]);
};
