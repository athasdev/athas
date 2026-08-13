interface TerminalPaneLifecycleState {
  previousTerminalCount: number;
  terminalCount: number;
  isTerminalPaneVisible: boolean;
}

export const shouldCloseTerminalPane = ({
  previousTerminalCount,
  terminalCount,
  isTerminalPaneVisible,
}: TerminalPaneLifecycleState): boolean =>
  isTerminalPaneVisible && previousTerminalCount > 0 && terminalCount === 0;
