export type SessionPanelTab = "changes" | "browser" | "terminal" | "plan";

/** The boxes beside an agent session, in the order they stack. */
export type SessionBoxId =
  | "environment"
  | "context"
  | "changes"
  | "running"
  | "plan"
  | "connectors";

/** The tool panel of one agent session, as the session left it. */
export interface SessionPanelState {
  /** A tool is open beside the conversation; closed, the session shows its boxes. */
  open: boolean;
  /** The tool the panel shows, and opens on next time. */
  tab: SessionPanelTab;
  /** The tool covers the conversation instead of sitting beside it. */
  fullscreen: boolean;
  /** The address the panel's browser shows; empty until something opens a page. */
  browserUrl: string;
  browserZoom?: number;
  /** Bumped when the session's terminal moves into an editor tab, naming the next one. */
  terminalGeneration: number;
  /** The browser opened itself for a dev server, which it does once per session. */
  autoOpened: boolean;
  updatedAt: number;
}
