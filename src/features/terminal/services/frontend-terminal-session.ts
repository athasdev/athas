import { commands } from "@/bindings/commands";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

interface FrontendTerminalSession {
  windowLabel: string;
  frontendSessionId: string;
}

let frontendTerminalSession: FrontendTerminalSession | null = null;
let frontendTerminalSessionReady: Promise<void> | null = null;

function getFrontendTerminalSession() {
  if (!frontendTerminalSession) {
    frontendTerminalSession = {
      windowLabel: getCurrentWebviewWindow().label,
      frontendSessionId: crypto.randomUUID(),
    };
  }

  return frontendTerminalSession;
}

/**
 * Registers this page load's terminal session with the backend, which closes the terminals a
 * previous load of the window left behind.
 */
export function initializeFrontendTerminalSession(): Promise<void> {
  if (!frontendTerminalSessionReady) {
    const { windowLabel, frontendSessionId } = getFrontendTerminalSession();
    frontendTerminalSessionReady = commands
      .beginFrontendTerminalSession(windowLabel, frontendSessionId)
      .then(() => undefined);
  }

  return frontendTerminalSessionReady;
}

/**
 * The session a new terminal registers under. It resolves once the session has begun, since the
 * backend rejects terminals for a session it has not registered yet.
 */
export async function getFrontendTerminalSessionArgs(): Promise<FrontendTerminalSession> {
  await frontendTerminalSessionReady?.catch(() => {});
  return getFrontendTerminalSession();
}
