import type * as Platform from "@/utils/platform";

// Outside a webview, @/utils/platform falls back to the host OS, so tests that
// assume macOS keybinding semantics (cmd stays cmd) pin it with:
// vi.mock("@/utils/platform", () => import("./macos-platform-mock"));
export const currentPlatform: typeof Platform.currentPlatform = "macos";
export const IS_MAC = true;
export const IS_WINDOWS = false;
export const IS_LINUX = false;
export const PLATFORM_CLASS_NAME = "platform-macos";
export const NODE_PLATFORM: typeof Platform.NODE_PLATFORM = "darwin";
export const PLATFORM_ARCH: typeof Platform.PLATFORM_ARCH = "darwin-arm64";
export const isMac = () => true;
export const isWindows = () => false;
export const isLinux = () => false;
export const normalizeKey = (key: string) => key;
export const applyPlatformClass: typeof Platform.applyPlatformClass = () => {};
