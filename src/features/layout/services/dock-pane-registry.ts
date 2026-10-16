import type { ComponentType, ReactNode } from "react";
import type { DockOwner, DockPaneId } from "../types/dock.types";

/**
 * The tools the dock can hold, contributed by the features that own them, as sidebar views are
 * (`sidebar-view-registry.ts`). A feature registers its panes from its registration module, and
 * references their components through `lazy()` so a pane's code loads the first time it shows.
 * Project tools are not registered here: every sidebar view is one, as `view:<id>`.
 */

export interface DockPaneProps {
  owner: DockOwner;
  /** The pane was asked to take focus once it shows. */
  focusRequested: boolean;
}

export interface DockPaneDefinition {
  id: DockPaneId;
  title: string;
  icon: ReactNode;
  /** Position in the menus that open panes, lowest first. */
  order: number;
  /** `session`: only a session's dock holds it; `any`: a project's dock too. */
  scope: "session" | "any";
  component: ComponentType<DockPaneProps>;
  /** Readings after the title, such as a count, and actions before maximize and close. */
  HeaderDetail?: ComponentType<DockPaneProps>;
  HeaderActions?: ComponentType<DockPaneProps>;
  /** Whether the owner can open it now, such as Plan only while the session has a plan. */
  useAvailable?: (owner: DockOwner) => boolean;
  /** The pane shows a view with its own title bar, whose actions move into the pane header. */
  hostsViewChrome?: boolean;
}

/**
 * What a session's dock shows about the session: its boxes as a column when no tool is open, and
 * one summary row above open tools that unfolds into the boxes.
 */
export interface DockSessionInfo {
  Column: ComponentType<{ chatId: string }>;
  Summary: ComponentType<{ chatId: string; expanded: boolean; onToggle: () => void }>;
  /** Whether the session has anything to show yet. */
  useHasContent: (chatId: string) => boolean;
}

const dockPanes = new Map<DockPaneId, DockPaneDefinition>();
let sortedDockPanes: DockPaneDefinition[] | null = null;
let sessionInfo: DockSessionInfo | null = null;

export function registerDockPane(definition: DockPaneDefinition) {
  dockPanes.set(definition.id, definition);
  sortedDockPanes = null;
}

export function getDockPane(id: DockPaneId): DockPaneDefinition | undefined {
  return dockPanes.get(id);
}

/** Every registered pane, in order. */
export function getDockPanes(): readonly DockPaneDefinition[] {
  sortedDockPanes ??= [...dockPanes.values()].sort((a, b) => a.order - b.order);
  return sortedDockPanes;
}

export function registerDockSessionInfo(info: DockSessionInfo) {
  sessionInfo = info;
}

export function getDockSessionInfo(): DockSessionInfo | null {
  return sessionInfo;
}

const PROJECT_TOOL_PREFIX = "view:";

/** The dock pane that shows a sidebar view. */
export function getProjectToolPaneId(view: string): DockPaneId {
  return `${PROJECT_TOOL_PREFIX}${view}`;
}

/** The sidebar view a project tool pane shows, or null for any other pane. */
export function getProjectToolView(pane: DockPaneId): string | null {
  return pane.startsWith(PROJECT_TOOL_PREFIX) ? pane.slice(PROJECT_TOOL_PREFIX.length) : null;
}
