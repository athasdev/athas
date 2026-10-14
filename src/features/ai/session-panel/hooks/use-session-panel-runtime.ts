import { useEffect } from "react";
import { startSessionPanelRuntime } from "../services/session-panel-runtime";

/** Lets agent session tools react to their sessions; the main window mounts it once. */
export function useSessionPanelRuntime() {
  useEffect(() => startSessionPanelRuntime(), []);
}
