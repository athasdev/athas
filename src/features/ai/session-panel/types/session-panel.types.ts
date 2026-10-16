/** A session's own tools, each a pane of its dock. */
export type SessionPanelTab = "changes" | "browser" | "terminal" | "plan";

/** The boxes of a session's details, in the order they stack. */
export type SessionBoxId =
  | "environment"
  | "context"
  | "changes"
  | "running"
  | "cost"
  | "plan"
  | "connectors";

/**
 * What one agent session's tools keep between visits. Which tools are open, their order and sizes
 * are the session's dock layout (`dock-layout.store.ts`).
 */
export interface SessionPanelState {
  /** The address the session's browser shows; empty until something opens a page. */
  browserUrl: string;
  browserZoom?: number;
  /** Bumped when the session's terminal moves into an editor tab, naming the next one. */
  terminalGeneration: number;
  /** The browser opened itself for a dev server, which it does once per session. */
  autoOpened: boolean;
  updatedAt: number;
}
