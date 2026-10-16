/**
 * What the dock beside the centre belongs to. An agent session keeps its own tools (its changes,
 * terminal, browser, plan and the project tools it opened); a project shown without a session
 * keeps the project's.
 */
export type DockOwner = { kind: "session"; id: string } | { kind: "project"; id: string };

/**
 * A pane the dock can hold. Session tools use their name (`changes`, `terminal`, `browser`,
 * `plan`); project tools are a sidebar view by its id, as `view:<id>` (`view:files`, `view:git`).
 */
export type DockPaneId = string;

/** The dock of one owner, as the user left it. */
export interface DockLayout {
  /** Open panes, top to bottom. */
  panes: DockPaneId[];
  /** Each open pane's share of the dock height; a pane without one takes an equal share. */
  sizes: Record<DockPaneId, number>;
  /** The pane covering the session and the dock, if any. */
  maximized: DockPaneId | null;
  /** The session details stay unfolded above open panes instead of folding into one row. */
  infoExpanded: boolean;
  updatedAt: number;
}
