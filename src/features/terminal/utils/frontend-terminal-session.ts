import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

interface FrontendTerminalSession {
  windowLabel: string;
  frontendSessionId: string;
}

let frontendTerminalSession: FrontendTerminalSession | null = null;

export function getFrontendTerminalSessionArgs() {
  if (!frontendTerminalSession) {
    frontendTerminalSession = {
      windowLabel: getCurrentWebviewWindow().label,
      frontendSessionId: crypto.randomUUID(),
    };
  }

  return frontendTerminalSession;
}

export async function initializeFrontendTerminalSession() {
  const { windowLabel, frontendSessionId } = getFrontendTerminalSessionArgs();
  await invoke("begin_frontend_terminal_session", {
    windowLabel,
    sessionId: frontendSessionId,
  });
}
