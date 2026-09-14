import type { OpenContentSpec } from "@/features/panes/types/pane-content.types";
import type { SettingsTab } from "@/features/window/stores/ui-state/types/ui-state.types";

/**
 * What a detached window hosts. Each kind has its own owner-side service and
 * its own window component, but they all share the window shell, the
 * BroadcastChannel transport and the base messages below.
 */
export type DetachedWindowKind = "agent" | "resource" | "standalone";

export interface DetachedWindowTarget {
  kind: DetachedWindowKind;
  channel: string;
  /**
   * Kind-specific JSON the window needs to show its content on its own. A
   * window that gets everything here works without the owner answering.
   */
  payload?: string;
}

const DETACHED_WINDOW_KINDS: readonly DetachedWindowKind[] = ["agent", "resource", "standalone"];
const CHANNEL_PATTERN = /^[a-zA-Z0-9-]+$/;

export function parseDetachedWindowUrl(url: URL): DetachedWindowTarget | null {
  if (url.searchParams.get("view") !== "detached") return null;
  const kind = url.searchParams.get("kind");
  const channel = url.searchParams.get("channel");
  if (!kind || !channel) return null;
  if (!DETACHED_WINDOW_KINDS.includes(kind as DetachedWindowKind)) return null;
  if (!CHANNEL_PATTERN.test(channel)) return null;
  const payload = url.searchParams.get("payload");
  return payload
    ? { kind: kind as DetachedWindowKind, channel, payload }
    : { kind: kind as DetachedWindowKind, channel };
}

export function getDetachedWindowChannelName(channel: string) {
  return `athas-window-${channel}`;
}

/**
 * Messages every detached window exchanges with its owner, regardless of what
 * it hosts. Kinds extend this union with their own messages.
 */
export type DetachedWindowBaseMessage =
  | { type: "ready" }
  | { type: "focus" }
  | { type: "workbench"; content: OpenContentSpec }
  | { type: "settings"; tab?: SettingsTab; section?: string };
