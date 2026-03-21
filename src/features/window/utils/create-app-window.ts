import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

const DEFAULT_WINDOW_OPTIONS = {
  url: "/",
  title: "",
  width: 1200,
  height: 800,
  minWidth: 400,
  minHeight: 400,
  center: true,
  decorations: true,
  resizable: true,
  shadow: true,
  hiddenTitle: true,
  titleBarStyle: "overlay" as const,
};

export function createAppWindow() {
  const label = `main-${Date.now()}`;
  return new WebviewWindow(label, DEFAULT_WINDOW_OPTIONS);
}
