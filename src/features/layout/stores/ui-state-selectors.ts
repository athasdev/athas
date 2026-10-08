/**
 * Whether the bottom pane is open on its terminal tab. Visibility is stored once, as the bottom
 * pane's own state; this is the one place that reads it as "the terminal is showing".
 */
export const selectIsTerminalPaneVisible = (state: {
  isBottomPaneVisible: boolean;
  bottomPaneActiveTab: string;
}) => state.isBottomPaneVisible && state.bottomPaneActiveTab === "terminal";
