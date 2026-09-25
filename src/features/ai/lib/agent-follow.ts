import type { AcpToolCallLocation } from "@/features/ai/types/acp.types";

/** At most one editor jump per this many milliseconds while following an agent. */
export const AGENT_FOLLOW_INTERVAL_MS = 300;

export interface AgentFollowTarget {
  path: string;
  /** 1-based, when the agent reported one. */
  line: number | null;
}

/**
 * Where a tool call says the agent is. Like Zed, the last reported location wins: a tool
 * that lists several files is working through them in order.
 */
export function pickAgentFollowTarget(
  locations: AcpToolCallLocation[] | null | undefined,
): AgentFollowTarget | null {
  const list = locations ?? [];
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const location = list[index];
    if (!location?.path) continue;
    const line = typeof location.line === "number" && location.line > 0 ? location.line : null;
    return { path: location.path, line };
  }
  return null;
}

export function isSameAgentFollowTarget(
  left: AgentFollowTarget | null | undefined,
  right: AgentFollowTarget | null | undefined,
): boolean {
  return Boolean(left && right && left.path === right.path && left.line === right.line);
}

export interface AgentFollowEligibility {
  /** The chat's follow toggle. */
  following: boolean;
  /** The chat has a turn running. */
  running: boolean;
  /** The chat is the tab the user is looking at: the active tab of the active pane. */
  visible: boolean;
  /** The chat lives in its own window, away from this window's editor. */
  detached: boolean;
}

/** Whether a reported location may move the editor right now. */
export function canFollowAgent({
  following,
  running,
  visible,
  detached,
}: AgentFollowEligibility): boolean {
  return following && running && visible && !detached;
}

export interface AgentFollowInterruption {
  following: boolean;
  running: boolean;
  /** The event came from the user, not from a script. */
  trusted: boolean;
  /** The pane the event landed in, or null outside every pane (sidebars, the title bar). */
  targetPaneId: string | null;
  /** The pane that holds the followed chat. */
  chatPaneId: string | null;
}

/**
 * Whether a click, key press or scroll means the user took over the editor. Only input in
 * another pane counts: typing in the composer or using the sidebars keeps following on.
 */
export function interruptsAgentFollow({
  following,
  running,
  trusted,
  targetPaneId,
  chatPaneId,
}: AgentFollowInterruption): boolean {
  if (!following || !running || !trusted || !targetPaneId) return false;
  return targetPaneId !== chatPaneId;
}

export interface AgentFollowClock {
  now: () => number;
  setTimeout: (callback: () => void, delay: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

const systemClock: AgentFollowClock = {
  now: () => Date.now(),
  setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface LatestThrottle<T> {
  push: (value: T) => void;
  cancel: () => void;
}

/**
 * Runs the first value at once, then at most once per `intervalMs`. Values that arrive in
 * between replace each other, so the run at the end of the interval gets the latest one.
 */
export function createLatestThrottle<T>(
  run: (value: T) => void,
  intervalMs: number,
  clock: AgentFollowClock = systemClock,
): LatestThrottle<T> {
  let lastRunAt = Number.NEGATIVE_INFINITY;
  let timer: unknown = null;
  let pending: { value: T } | null = null;

  const flush = () => {
    timer = null;
    if (!pending) return;
    const { value } = pending;
    pending = null;
    lastRunAt = clock.now();
    run(value);
  };

  return {
    push(value) {
      pending = { value };
      if (timer !== null) return;
      const wait = lastRunAt + intervalMs - clock.now();
      if (wait <= 0) {
        flush();
        return;
      }
      timer = clock.setTimeout(flush, wait);
    },
    cancel() {
      pending = null;
      if (timer !== null) clock.clearTimeout(timer);
      timer = null;
    },
  };
}

interface FollowPaneCandidate {
  id: string;
  bufferIds: string[];
  locked?: boolean;
}

/**
 * The pane the followed file opens in: never the chat's own pane (that would hide the chat).
 * A pane already showing the file comes first, then the most recently used unlocked pane.
 * Null means there is no such pane and the caller splits one off the chat.
 */
export function pickAgentFollowPaneId({
  panes,
  chatPaneId,
  bufferId,
  mostRecentActivePaneIds,
}: {
  panes: FollowPaneCandidate[];
  chatPaneId: string;
  /** The file's buffer, when it is already open. */
  bufferId: string | null;
  mostRecentActivePaneIds: string[];
}): string | null {
  const candidates = panes.filter((pane) => pane.id !== chatPaneId && !pane.locked);
  if (bufferId) {
    const showing = candidates.find((pane) => pane.bufferIds.includes(bufferId));
    if (showing) return showing.id;
  }
  for (const paneId of mostRecentActivePaneIds) {
    if (candidates.some((pane) => pane.id === paneId)) return paneId;
  }
  return candidates[0]?.id ?? null;
}
