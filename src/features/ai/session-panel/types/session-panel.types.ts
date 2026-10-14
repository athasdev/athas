export type SessionPanelTab = "changes" | "browser" | "terminal" | "plan" | "activity";

/** The tool card of one agent session, as the session left it. */
export interface SessionPanelState {
  /** The card is expanded from its pill; collapsed, only the pills show. */
  open: boolean;
  /** The tool the card shows, and opens on next time. */
  tab: SessionPanelTab;
  /** The card fills the whole session instead of its right part. */
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
