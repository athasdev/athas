import { exit } from "@tauri-apps/plugin-process";
import { useEffect } from "react";
import type { Buffer } from "../types/buffer";
import type { CoreFeaturesState } from "../types/core-features";
import { isMac } from "../utils/platform";

interface UseKeyboardShortcutsProps {
  setIsBottomPaneVisible: (value: boolean | ((prev: boolean) => boolean)) => void;
  setBottomPaneActiveTab: (tab: "terminal" | "diagnostics") => void;
  setIsFindVisible: (value: boolean | ((prev: boolean) => boolean)) => void;
  setIsSidebarVisible: (value: boolean | ((prev: boolean) => boolean)) => void;
  setIsRightPaneVisible: (value: boolean | ((prev: boolean) => boolean)) => void;
  setIsCommandBarVisible: (value: boolean | ((prev: boolean) => boolean)) => void;
  setIsCommandPaletteVisible: (value: boolean | ((prev: boolean) => boolean)) => void;
  setIsSearchViewActive: (value: boolean) => void;
  focusSearchInput: () => void;
  focusCommandPalette: () => void;
  activeBuffer: Buffer | null;
  closeBuffer: (bufferId: string) => void;
  switchToNextBuffer: () => void;
  switchToPreviousBuffer: () => void;
  buffers: Buffer[];
  setActiveBuffer: (bufferId: string) => void;
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
}: UseKeyboardShortcutsProps) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Terminal toggle is now handled by native menu accelerator on macOS
      // Only handle on non-macOS platforms
      if ((e.metaKey || e.ctrlKey) && e.key === "j" && coreFeatures.terminal && !isMac()) {
        e.preventDefault();
        if (isBottomPaneVisible && bottomPaneActiveTab === "terminal") {
          setIsBottomPaneVisible(false);
        } else {
          setBottomPaneActiveTab("terminal");
          setIsBottomPaneVisible(true);
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

      // Cmd+K (Mac) or Ctrl+K (Windows/Linux) to open AI quick edit
      if (
        (e.metaKey || e.ctrlKey) &&
        (e.key === "k" || e.key === "K") &&
        !e.shiftKey &&
        coreFeatures.aiChat
      ) {
        e.preventDefault();
        e.stopPropagation();
        if (onQuickEdit) {
          onQuickEdit();
        }
        return;
      }

      // Find is now handled by native menu accelerator on macOS
      // Only handle on non-macOS platforms
      if ((e.metaKey || e.ctrlKey) && e.key === "f" && !e.shiftKey && !isMac()) {
        e.preventDefault();
        setIsFindVisible(prev => !prev);
        return;
      }

      // Cmd+Shift+F (Mac) or Ctrl+Shift+F (Windows/Linux) to open project search
      const isMacOS = isMac();
      const correctModifier = isMacOS ? e.metaKey : e.ctrlKey;

      if (correctModifier && e.shiftKey && e.key === "F" && coreFeatures.search) {
        e.preventDefault();
        e.stopPropagation();
        setIsSidebarVisible(true);
        setIsSearchViewActive(true);
        // Focus the search input after a short delay to ensure the view is rendered
        setTimeout(() => {
          focusSearchInput();
        }, 100);
        return;
      }

      // Also handle if Mac users are somehow sending ctrlKey instead of metaKey
      if (isMacOS && e.ctrlKey && e.shiftKey && e.key === "F" && coreFeatures.search) {
        e.preventDefault();
        e.stopPropagation();
        console.log("Mac detected but using ctrlKey - this is unusual");
        setIsSidebarVisible(true);
        setIsSearchViewActive(true);
        setTimeout(() => {
          focusSearchInput();
        }, 100);
        return;
      }

      // Alternative shortcut: Cmd+Shift+H (Mac) or Ctrl+Shift+H (Windows/Linux) to open project search
      // This is a backup in case Cmd+Shift+F is captured by the browser/system
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "H" && coreFeatures.search) {
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
        setIsSidebarVisible(prev => !prev);
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
        setIsRightPaneVisible(prev => !prev);
        return;
      }

      // Go to File is now handled by native menu accelerator on macOS
      // Only handle on non-macOS platforms
      if ((e.metaKey || e.ctrlKey) && e.key === "p" && !e.shiftKey && !isMac()) {
        e.preventDefault();
        setIsCommandBarVisible(prev => !prev);
        return;
      }

      // Command Palette is now handled by native menu accelerator on macOS
      // Only handle on non-macOS platforms
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "P" && !isMac()) {
        e.preventDefault();
        setIsCommandPaletteVisible(prev => !prev);
        // Focus the command palette after a short delay to ensure it's rendered
        setTimeout(() => {
          focusCommandPalette();
        }, 100);
        return;
      }

      // Close Tab is now handled by native menu accelerator on macOS
      // Only handle on non-macOS platforms
      if ((e.metaKey || e.ctrlKey) && e.key === "w" && !e.shiftKey && !isMac()) {
        e.preventDefault();
        if (activeBuffer) {
          closeBuffer(activeBuffer.id);
        }
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
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    setIsBottomPaneVisible,
    setBottomPaneActiveTab,
    setIsFindVisible,
    setIsSidebarVisible,
    setIsRightPaneVisible,
    setIsCommandBarVisible,
    setIsCommandPaletteVisible,
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
  ]);
};
