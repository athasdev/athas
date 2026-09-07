import type { Platform } from "@tauri-apps/plugin-os";
import { currentPlatform } from "@/utils/platform";

type TerminalLinkPlatform = Platform;
type TerminalLinkMouseEvent = Pick<MouseEvent, "metaKey" | "ctrlKey">;

const EXTERNAL_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

const isApplePlatform = (platform: TerminalLinkPlatform) =>
  platform === "macos" || platform === "ios";

export function isTerminalLinkModifierPressed(
  event: TerminalLinkMouseEvent,
  platform: TerminalLinkPlatform = currentPlatform,
): boolean {
  return isApplePlatform(platform) ? event.metaKey : event.ctrlKey;
}

export function getTerminalLinkModifierLabel(platform: TerminalLinkPlatform = currentPlatform) {
  return isApplePlatform(platform) ? "⌘" : "Ctrl";
}

export function describeTerminalLinkHint(
  kind: "file" | "url",
  platform: TerminalLinkPlatform = currentPlatform,
) {
  const modifier = getTerminalLinkModifierLabel(platform);
  return kind === "file" ? `${modifier}+click to open in editor` : `${modifier}+click to open link`;
}

export function resolveExternalLinkTarget(uri: string): string | null {
  const trimmed = uri.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    if (!EXTERNAL_LINK_PROTOCOLS.has(url.protocol)) return null;
    return url.href;
  } catch {
    return null;
  }
}
