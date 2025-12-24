import {
  AlertCircle,
  ArrowLeftRight,
  Globe,
  Menu,
  MessageSquare,
  PanelBottom,
  PanelLeft,
  RotateCcw,
  Search,
  Terminal,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { Action } from "../models/action.types";

interface ViewActionsParams {
  isSidebarVisible: boolean;
  setIsSidebarVisible: (v: boolean) => void;
  isBottomPaneVisible: boolean;
  setIsBottomPaneVisible: (v: boolean) => void;
  bottomPaneActiveTab: "terminal" | "diagnostics";
  setBottomPaneActiveTab: (tab: "terminal" | "diagnostics") => void;
  isFindVisible: boolean;
  setIsFindVisible: (v: boolean) => void;
  settings: {
    isAIChatVisible: boolean;
    sidebarPosition: "left" | "right";
    nativeMenuBar: boolean;
    compactMenuBar: boolean;
  };
  updateSetting: (key: string, value: any) => void | Promise<void>;
  zoomIn: (target: "window" | "terminal") => void;
  zoomOut: (target: "window" | "terminal") => void;
  resetZoom: (target: "window" | "terminal") => void;
  openWebViewerBuffer: (url: string) => void;
  onClose: () => void;
}

export const createViewActions = (params: ViewActionsParams): Action[] => {
  const {
    isSidebarVisible,
    setIsSidebarVisible,
    isBottomPaneVisible,
    setIsBottomPaneVisible,
    bottomPaneActiveTab,
    setBottomPaneActiveTab,
    isFindVisible,
    setIsFindVisible,
    settings,
    updateSetting,
    zoomIn,
    zoomOut,
    resetZoom,
    openWebViewerBuffer,
    onClose,
  } = params;

  return [
    {
      id: "toggle-sidebar",
      label: isSidebarVisible ? "View: Hide Sidebar" : "View: Show Sidebar",
      description: isSidebarVisible ? "Hide the sidebar panel" : "Show the sidebar panel",
      icon: <PanelLeft size={14} />,
      category: "View",
      keybinding: ["⌘", "B"],
      action: () => {
        setIsSidebarVisible(!isSidebarVisible);
        onClose();
      },
    },
    {
      id: "toggle-bottom-pane",
      label: isBottomPaneVisible ? "View: Hide Bottom Pane" : "View: Show Bottom Pane",
      description: isBottomPaneVisible ? "Hide the bottom pane" : "Show the bottom pane",
      icon: <PanelBottom size={14} />,
      category: "View",
      action: () => {
        setIsBottomPaneVisible(!isBottomPaneVisible);
        onClose();
      },
    },
    {
      id: "toggle-terminal",
      label:
        isBottomPaneVisible && bottomPaneActiveTab === "terminal"
          ? "View: Hide Terminal"
          : "View: Show Terminal",
      description: "Toggle integrated terminal panel",
      icon: <Terminal size={14} />,
      category: "View",
      keybinding: ["⌘", "`"],
      action: () => {
        if (isBottomPaneVisible && bottomPaneActiveTab === "terminal") {
          setIsBottomPaneVisible(false);
        } else {
          setBottomPaneActiveTab("terminal");
          setIsBottomPaneVisible(true);
        }
        onClose();
      },
    },
    {
      id: "toggle-diagnostics-panel",
      label:
        isBottomPaneVisible && bottomPaneActiveTab === "diagnostics"
          ? "View: Hide Diagnostics"
          : "View: Show Diagnostics",
      description: "Toggle diagnostics panel",
      icon: <AlertCircle size={14} />,
      category: "View",
      keybinding: ["⌘", "⇧", "J"],
      action: () => {
        if (isBottomPaneVisible && bottomPaneActiveTab === "diagnostics") {
          setIsBottomPaneVisible(false);
        } else {
          setBottomPaneActiveTab("diagnostics");
          setIsBottomPaneVisible(true);
        }
        onClose();
      },
    },
    {
      id: "toggle-ai-chat-view",
      label: settings.isAIChatVisible ? "View: Hide AI Chat" : "View: Show AI Chat",
      description: settings.isAIChatVisible ? "Hide AI chat panel" : "Show AI chat panel",
      icon: <MessageSquare size={14} />,
      category: "View",
      keybinding: ["⌘", "R"],
      action: () => {
        updateSetting("isAIChatVisible", !settings.isAIChatVisible);
        onClose();
      },
    },
    {
      id: "toggle-find-view",
      label: isFindVisible ? "View: Hide Find" : "View: Show Find",
      description: isFindVisible ? "Hide find in file" : "Show find in file",
      icon: <Search size={14} />,
      category: "View",
      keybinding: ["⌘", "F"],
      action: () => {
        setIsFindVisible(!isFindVisible);
        onClose();
      },
    },
    {
      id: "toggle-sidebar-position",
      label: "View: Switch Sidebar Position",
      description:
        settings.sidebarPosition === "left"
          ? "Move sidebar to right side"
          : "Move sidebar to left side",
      icon: <ArrowLeftRight size={14} />,
      category: "View",
      keybinding: ["⌘", "⇧", "B"],
      action: () => {
        updateSetting("sidebarPosition", settings.sidebarPosition === "left" ? "right" : "left");
        onClose();
      },
    },
    {
      id: "toggle-native-menu-bar",
      label: settings.nativeMenuBar
        ? "View: Disable Native Menu Bar"
        : "View: Enable Native Menu Bar",
      description: settings.nativeMenuBar
        ? "Use custom menu bar"
        : "Use native operating system menu bar",
      icon: <Menu size={14} />,
      category: "View",
      action: async () => {
        const newValue = !settings.nativeMenuBar;
        updateSetting("nativeMenuBar", newValue);
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("toggle_menu_bar", { toggle: newValue });
        onClose();
      },
    },
    {
      id: "toggle-compact-menu-bar",
      label: settings.compactMenuBar
        ? "View: Disable Compact Menu Bar"
        : "View: Enable Compact Menu Bar",
      description: settings.compactMenuBar
        ? "Show full menu bar"
        : "Use compact menu bar with hamburger icon",
      icon: <Menu size={14} />,
      category: "View",
      action: () => {
        updateSetting("compactMenuBar", !settings.compactMenuBar);
        onClose();
      },
    },
    {
      id: "view-zoom-in",
      label: "View: Zoom In",
      description: "Increase zoom level",
      icon: <ZoomIn size={14} />,
      category: "View",
      keybinding: ["⌘", "+"],
      action: () => {
        zoomIn("window");
        onClose();
      },
    },
    {
      id: "view-zoom-out",
      label: "View: Zoom Out",
      description: "Decrease zoom level",
      icon: <ZoomOut size={14} />,
      category: "View",
      keybinding: ["⌘", "-"],
      action: () => {
        zoomOut("window");
        onClose();
      },
    },
    {
      id: "view-reset-zoom",
      label: "View: Reset Zoom",
      description: "Reset zoom to default level",
      icon: <RotateCcw size={14} />,
      category: "View",
      keybinding: ["⌘", "0"],
      action: () => {
        resetZoom("window");
        onClose();
      },
    },
    {
      id: "terminal-zoom-in",
      label: "Terminal: Zoom In",
      description: "Increase terminal zoom level",
      icon: <ZoomIn size={14} />,
      category: "Terminal",
      action: () => {
        zoomIn("terminal");
        onClose();
      },
    },
    {
      id: "terminal-zoom-out",
      label: "Terminal: Zoom Out",
      description: "Decrease terminal zoom level",
      icon: <ZoomOut size={14} />,
      category: "Terminal",
      action: () => {
        zoomOut("terminal");
        onClose();
      },
    },
    {
      id: "terminal-reset-zoom",
      label: "Terminal: Reset Zoom",
      description: "Reset terminal zoom to default level",
      icon: <RotateCcw size={14} />,
      category: "Terminal",
      action: () => {
        resetZoom("terminal");
        onClose();
      },
    },
    {
      id: "open-web-viewer",
      label: "View: Open Web Viewer",
      description: "Open a new web viewer tab",
      icon: <Globe size={14} />,
      category: "View",
      action: () => {
        openWebViewerBuffer("about:blank");
        onClose();
      },
    },
    {
      id: "open-url",
      label: "View: Open URL...",
      description: "Open a URL in web viewer",
      icon: <Globe size={14} />,
      category: "View",
      action: async () => {
        const url = prompt("Enter URL:", "https://");
        if (url?.trim()) {
          openWebViewerBuffer(url.trim());
        }
        onClose();
      },
    },
  ];
};
