import { SessionSignalPills, useSessionPillsPlacement } from "./session-signal-pills";

/** The session's pills in its header, when the session is too narrow for them to float. */
export function SessionPanelHeaderActions({ chatId }: { chatId: string }) {
  const placement = useSessionPillsPlacement();
  return placement === "header" ? <SessionSignalPills chatId={chatId} placement="header" /> : null;
}
