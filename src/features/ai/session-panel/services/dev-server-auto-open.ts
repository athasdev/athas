/** Waits between reachability checks: dev servers print their address just before they listen. */
export const DEV_SERVER_PROBE_DELAYS_MS = [0, 750, 1500, 3000, 5000];
/** How long after a keystroke the user still counts as typing. */
export const TYPING_IDLE_MS = 1500;
const TYPING_RECHECK_MS = 400;

export interface DevServerAutoOpenDependencies {
  isReachable: (url: string) => Promise<boolean>;
  isUserTyping: () => boolean;
  wait: (ms: number) => Promise<void>;
  hasAutoOpened: (chatId: string) => boolean;
  /** Called once the server answers, whether or not the browser opens for it. */
  markReachable: (chatId: string, url: string) => void;
  open: (chatId: string, url: string) => void;
}

/**
 * Checks that a dev server a session's commands started answers, then opens the session's
 * browser at it. The browser opens once per session; each address is checked once at a time and
 * not again once it answered, and the open waits while the user types so the layout never shifts
 * under their keystrokes.
 */
export function createDevServerAutoOpener(dependencies: DevServerAutoOpenDependencies) {
  const pending = new Set<string>();
  const reachable = new Set<string>();

  return {
    async consider(chatId: string, url: string): Promise<boolean> {
      const key = `${chatId}\n${url}`;
      if (pending.has(key) || reachable.has(key)) return false;
      pending.add(key);
      try {
        let answered = false;
        for (const delay of DEV_SERVER_PROBE_DELAYS_MS) {
          if (delay > 0) await dependencies.wait(delay);
          if (await dependencies.isReachable(url).catch(() => false)) {
            answered = true;
            break;
          }
        }
        if (!answered) return false;
        reachable.add(key);
        dependencies.markReachable(chatId, url);
        if (dependencies.hasAutoOpened(chatId)) return false;
        while (dependencies.isUserTyping()) await dependencies.wait(TYPING_RECHECK_MS);
        if (dependencies.hasAutoOpened(chatId)) return false;
        dependencies.open(chatId, url);
        return true;
      } finally {
        pending.delete(key);
      }
    },
    /** Lets an address that stopped answering be checked again when it shows up again. */
    forget(chatId: string, url: string) {
      reachable.delete(`${chatId}\n${url}`);
    },
  };
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as HTMLElement).tagName !== "string") return false;
  const element = target as HTMLElement;
  if (element.isContentEditable) return true;
  const tag = element.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select";
}

/** Notes keystrokes in editable fields (editors, the composer, terminals) to tell typing apart. */
export function createTypingTracker(
  target: Pick<Window, "addEventListener" | "removeEventListener">,
  now: () => number = Date.now,
  idleMs = TYPING_IDLE_MS,
) {
  let lastKeystrokeAt = Number.NEGATIVE_INFINITY;
  const onKeyDown = (event: Event) => {
    if (isEditableTarget(event.target)) lastKeystrokeAt = now();
  };
  target.addEventListener("keydown", onKeyDown, true);
  return {
    isTyping: () => now() - lastKeystrokeAt < idleMs,
    dispose: () => target.removeEventListener("keydown", onKeyDown, true),
  };
}
