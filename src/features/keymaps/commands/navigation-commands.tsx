import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BugIcon,
  FolderOpenIcon,
  GitBranchIcon,
  GitPullRequestIcon,
  ListIcon,
  PackageIcon,
  StackIcon,
} from "@/ui/icons";
import { getActiveCodeMirrorNavigation } from "@/features/editor/engines/codemirror/navigation/active-navigation";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import type { SidebarView } from "@/features/layout/utils/sidebar-pane-utils";
import { setOutlineVisibilityPreference } from "@/features/outline/actions/outline-visibility";
import { useUIState } from "@/features/window/stores/ui-state.store";
import { emitAppEvent } from "@/utils/app-events";
import { useKeymapStore } from "../stores/keymaps.store";
import type { Command } from "../types/keymaps.types";
import {
  expandActiveEditorSelection,
  goToActiveEditorMatchingBracket,
  removeActiveEditorBrackets,
  selectToActiveEditorBracket,
  shrinkActiveEditorSelection,
  triggerActiveEditorRenameSymbol,
} from "./editor-command-actions";
import {
  goBack,
  goForward,
  goToDefinition,
  goToImplementation,
  goToReferences,
  goToTypeDefinition,
  openOutlinePanel,
  openOutlinePicker,
  showCallHierarchy,
  showTypeHierarchy,
} from "./navigation-command-actions";

const isTerminalFocused = () => useKeymapStore.getState().contexts.terminalFocus;

const switchNextTab = () => {
  if (isTerminalFocused()) {
    emitAppEvent("terminal-switch-tab", "next");
  } else {
    useBufferStore.getState().actions.switchToNextBuffer();
  }
};

const switchPrevTab = () => {
  if (isTerminalFocused()) {
    emitAppEvent("terminal-switch-tab", "prev");
  } else {
    useBufferStore.getState().actions.switchToPreviousBuffer();
  }
};

function showSidebarView(view: SidebarView): void {
  const state = useUIState.getState();
  state.setIsSidebarVisible(true);
  state.setActiveView(view);
}

export const navigationCommands: Command[] = [
  {
    id: "editor.showOutline",
    title: "Go to Symbol in Editor",
    category: "Navigation",
    execute: openOutlinePicker,
  },
  {
    id: "workbench.showOutline",
    title: "Show Outline",
    category: "Navigation",
    execute: openOutlinePanel,
  },
  {
    id: "workbench.nextTab",
    title: "Next Tab",
    category: "Navigation",
    description: "Switch to the next open tab",
    icon: <ArrowRightIcon />,
    palette: { label: "Tab: Next Tab", category: "File" },
    execute: switchNextTab,
  },
  {
    id: "workbench.nextTabCtrlTab",
    title: "Next Tab (Ctrl+Tab)",
    category: "Navigation",
    execute: switchNextTab,
  },
  {
    id: "workbench.previousTab",
    title: "Previous Tab",
    category: "Navigation",
    description: "Switch to the previous open tab",
    icon: <ArrowLeftIcon />,
    palette: { label: "Tab: Previous Tab", category: "File" },
    execute: switchPrevTab,
  },
  {
    id: "workbench.previousTabCtrlTab",
    title: "Previous Tab (Ctrl+Shift+Tab)",
    category: "Navigation",
    execute: switchPrevTab,
  },
  {
    id: "workbench.nextTabAlt",
    title: "Next Tab (Alt)",
    category: "Navigation",
    execute: switchNextTab,
  },
  {
    id: "workbench.previousTabAlt",
    title: "Previous Tab (Alt)",
    category: "Navigation",
    execute: switchPrevTab,
  },
  ...Array.from({ length: 9 }, (_, i) => ({
    id: `workbench.switchToTab${i + 1}`,
    title: `Switch to Tab ${i + 1}`,
    category: "Navigation",
    execute: () => {
      if (isTerminalFocused()) {
        emitAppEvent("terminal-activate-tab", i);
        return;
      }
      const bufferStore = useBufferStore.getState();
      const buffer = bufferStore.buffers[i];
      if (buffer) bufferStore.actions.setActiveBuffer(buffer.id);
    },
  })),
  {
    id: "editor.goToDefinition",
    title: "Go to Definition",
    category: "Navigation",
    execute: goToDefinition,
  },
  {
    id: "editor.goToImplementation",
    title: "Go to Implementation",
    category: "Navigation",
    execute: goToImplementation,
  },
  {
    id: "editor.goToTypeDefinition",
    title: "Go to Type Definition",
    category: "Navigation",
    execute: goToTypeDefinition,
  },
  {
    id: "editor.goToReferences",
    title: "Go to References",
    category: "Navigation",
    execute: goToReferences,
  },
  {
    id: "editor.peekReferences",
    title: "Peek References",
    category: "Navigation",
    execute: () => {
      if (!getActiveCodeMirrorNavigation()?.peekReferences()) void goToReferences();
    },
  },
  {
    id: "editor.showCallHierarchy",
    title: "Show Call Hierarchy",
    category: "Navigation",
    execute: showCallHierarchy,
  },
  {
    id: "editor.showTypeHierarchy",
    title: "Show Type Hierarchy",
    category: "Navigation",
    execute: showTypeHierarchy,
  },
  {
    id: "editor.goToBracket",
    title: "Go to Bracket",
    category: "Navigation",
    execute: goToActiveEditorMatchingBracket,
  },
  {
    id: "editor.selectToBracket",
    title: "Select to Bracket",
    category: "Navigation",
    execute: selectToActiveEditorBracket,
  },
  {
    id: "editor.removeBrackets",
    title: "Remove Brackets",
    category: "Navigation",
    execute: removeActiveEditorBrackets,
  },
  {
    id: "editor.expandSelection",
    title: "Expand Selection",
    category: "Selection",
    execute: () => {
      if (!getActiveCodeMirrorNavigation()?.expandSelection()) expandActiveEditorSelection();
    },
  },
  {
    id: "editor.shrinkSelection",
    title: "Shrink Selection",
    category: "Selection",
    execute: () => {
      if (!getActiveCodeMirrorNavigation()?.shrinkSelection()) shrinkActiveEditorSelection();
    },
  },
  {
    id: "editor.renameSymbol",
    title: "Rename Symbol",
    category: "Navigation",
    execute: triggerActiveEditorRenameSymbol,
  },
  {
    id: "navigation.goBack",
    title: "Go Back",
    category: "Navigation",
    execute: goBack,
  },
  {
    id: "navigation.goForward",
    title: "Go Forward",
    category: "Navigation",
    execute: goForward,
  },
  {
    id: "view.showFiles",
    title: "View: Show Files",
    category: "Navigation",
    description: "Switch to files view",
    icon: <FolderOpenIcon />,
    palette: { keybindingCommandId: "workbench.showFileExplorer" },
    execute: () => showSidebarView("files"),
  },
  {
    id: "view.showGit",
    title: "View: Show Git",
    category: "Navigation",
    description: "Switch to Git view",
    icon: <GitBranchIcon />,
    palette: { keybindingCommandId: "workbench.showSourceControl" },
    execute: () => showSidebarView("git"),
  },
  {
    id: "view.showPullRequests",
    title: "View: Show Pull Requests",
    category: "Navigation",
    description: "Switch to GitHub Pull Requests view",
    icon: <GitPullRequestIcon />,
    palette: { keybindingCommandId: "workbench.showGitHub" },
    execute: () => showSidebarView("github-prs"),
  },
  {
    id: "view.showViews",
    title: "View: Show Views",
    category: "Navigation",
    description: "Switch to project custom views",
    icon: <StackIcon />,
    palette: { keybindingCommandId: "workbench.showViews" },
    execute: () => showSidebarView("views"),
  },
  {
    id: "view.showRunAndDebug",
    title: "View: Show Run and Debug",
    category: "Navigation",
    description: "Switch to debugger view",
    icon: <BugIcon />,
    palette: { keybindingCommandId: "workbench.showDebugger" },
    execute: () => {
      const state = useUIState.getState();
      state.setBottomPaneActiveTab("debugger");
      state.setIsBottomPaneVisible(true);
    },
  },
  {
    id: "view.showOutline",
    title: "View: Show Outline",
    category: "Navigation",
    description: "Show symbols for the active file in the sidebar",
    icon: <ListIcon />,
    when: ({ activeBuffer }) => activeBuffer?.type === "editor",
    palette: { keybindingCommandId: "workbench.showOutline" },
    execute: () => setOutlineVisibilityPreference(true),
  },
  {
    id: "view.showIntegrations",
    title: "View: Show Integrations",
    category: "Navigation",
    description: "Open the integrations tab",
    icon: <PackageIcon />,
    palette: true,
    execute: () => {
      useBufferStore.getState().actions.openExtensionsBuffer();
    },
  },
  {
    id: "go.symbolInEditor",
    title: "Go: Symbol in Editor",
    category: "Navigation",
    description: "Open the active file outline picker",
    icon: <ListIcon />,
    palette: { keybindingCommandId: "editor.showOutline" },
    execute: () => useUIState.getState().openCommandPaletteView("outline"),
  },
];
