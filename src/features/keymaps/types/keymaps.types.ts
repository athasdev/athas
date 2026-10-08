/**
 * Core types for the keymaps system
 */

import type { ReactNode } from "react";
import type { PaneContent } from "@/features/panes/types/pane-content.types";
import type { Settings } from "@/features/settings/types/settings.types";
import type { BottomPaneTab } from "@/features/layout/stores/ui-state/types/ui-state.types";

export interface Keybinding {
  key: string;
  command: string;
  when?: string;
  args?: unknown;
  source: "user" | "extension" | "default" | "preset";
  enabled?: boolean;
  replaceDefaults?: boolean;
}

/**
 * Workbench state that decides whether a command is offered and how it is labelled. The command
 * palette builds it reactively; predicates and presentations must stay pure functions of it.
 */
export interface CommandContext {
  settings: Settings;
  ui: {
    isSidebarVisible: boolean;
    isBottomPaneVisible: boolean;
    bottomPaneActiveTab: BottomPaneTab;
  };
  activeBuffer: {
    id: string;
    type: PaneContent["type"];
    path: string;
    isVirtual: boolean;
    isMarkdownPreview: boolean;
  } | null;
  lspStatus: {
    status: string;
    activeWorkspaces: string[];
    lastError?: string | null;
  };
  agent: {
    /** The interactive CLI of the current chat's agent, when it has one. */
    cli: { name: string; command: string } | null;
    /** The current chat's running agent, when it advertises ACP logout. */
    logOutAgentId: string | null;
    /** The current chat's running agent, when it lists its sessions (ACP `session/list`). */
    browseSessionsAgentId: string | null;
  };
}

/**
 * When the command palette closes relative to running a command:
 * - `before`: close, then run (default)
 * - `settled`: run, then close once the command's promise settles
 * - `never`: the command drives the palette itself (for example by pushing a palette view)
 */
export type CommandPaletteClose = "before" | "settled" | "never";

export interface CommandPaletteEntry {
  /** Defaults to the command title. */
  label?: string;
  /** Defaults to the command description. */
  description?: string;
  /** Defaults to the command icon. */
  icon?: ReactNode;
  /** Palette category, which also picks the palette filter tab. Defaults to the command category. */
  category?: string;
  /** Command whose effective keybinding is shown. Defaults to the command itself. */
  keybindingCommandId?: string;
  closePalette?: CommandPaletteClose;
}

export interface Command {
  /** Stable id: user keybindings and command palette history reference it. */
  id: string;
  title: string;
  category?: string;
  description?: string;
  icon?: ReactNode;
  /** Whether the command is offered right now. Commands without a predicate are always offered. */
  when?: (context: CommandContext) => boolean;
  /** Presence in the command palette. Commands without it are reachable by keybinding only. */
  palette?: true | CommandPaletteEntry | ((context: CommandContext) => CommandPaletteEntry);
  execute: (args?: unknown) => void | Promise<void>;
}

export interface KeymapContext {
  editorFocus: boolean;
  vimMode: boolean;
  vimNormalMode: boolean;
  vimInsertMode: boolean;
  vimVisualMode: boolean;
  terminalFocus: boolean;
  sidebarFocus: boolean;
  findWidgetVisible: boolean;
  hasSelection: boolean;
  isRecordingKeybinding: boolean;
  [key: string]: boolean;
}

export interface KeymapStore {
  keybindings: Keybinding[];
  contexts: Partial<KeymapContext>;
}
