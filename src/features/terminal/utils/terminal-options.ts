import { version } from "@tauri-apps/plugin-os";
import type { ITerminalOptions } from "@xterm/xterm";
import { currentPlatform } from "@/utils/platform";

type TerminalPlatform = "linux" | "macos" | "windows";

export interface TerminalCompatibilityContext {
  isRemote?: boolean;
  osVersion?: string;
  platform?: TerminalPlatform;
}

export function parseWindowsBuildNumber(osVersion: string): number | undefined {
  const parts = osVersion.match(/\d+/g);
  if (!parts || parts.length < 3) return undefined;

  const buildNumber = Number(parts[2]);
  return Number.isSafeInteger(buildNumber) && buildNumber > 0 ? buildNumber : undefined;
}

export function getTerminalCompatibilityOptions(
  context: TerminalCompatibilityContext = {},
): Partial<ITerminalOptions> {
  const platform = context.platform ?? currentPlatform;
  const options: Partial<ITerminalOptions> = {
    customGlyphs: true,
    macOptionClickForcesSelection: platform === "macos",
    reflowCursorLine: false,
    rescaleOverlappingGlyphs: true,
    scrollOnUserInput: true,
    smoothScrollDuration: 0,
  };

  if (platform === "windows" && !context.isRemote) {
    let osVersion = context.osVersion;
    if (osVersion === undefined) {
      try {
        osVersion = version();
      } catch {
        osVersion = "";
      }
    }

    options.windowsPty = {
      backend: "conpty",
      buildNumber: parseWindowsBuildNumber(osVersion),
    };
  }

  return options;
}
