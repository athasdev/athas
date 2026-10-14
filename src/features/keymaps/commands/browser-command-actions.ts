import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { resolveBrowserAddress } from "@/features/browser/services/browser-address";
import { useBrowserTabStore } from "@/features/browser/stores/browser-tab.store";
import { showPromptDialog } from "@/ui/dialog";
import { emitAppEvent } from "@/utils/app-events";

const loadBrowserTabManager = () =>
  import("@/features/browser/services/browser-tab-manager").then(
    ({ browserTabManager }) => browserTabManager,
  );

/**
 * The browser tab shown in the active pane, if the active buffer is one, else the page with
 * keyboard focus, such as the browser in an agent session's panel.
 */
function getActiveBrowserBufferId(): string | null {
  const buffer = useBufferStore.getState().actions.getActiveBuffer();
  if (buffer?.type === "browser") return buffer.id;
  return useBrowserTabStore.getState().focusedBufferId;
}

export function openNewBrowserTab(url?: string): void {
  useBufferStore.getState().actions.openBrowserBuffer(url);
}

export async function openUrlInBrowserTab(): Promise<void> {
  const value = await showPromptDialog("Enter an address or a search", {
    title: "Open URL",
    placeholder: "localhost:5173",
    confirmLabel: "Open",
  });
  const url = value ? resolveBrowserAddress(value) : null;
  if (url) openNewBrowserTab(url);
}

export async function focusBrowserAddressBar(): Promise<void> {
  const bufferId = getActiveBrowserBufferId();
  if (!bufferId) return;
  await (await loadBrowserTabManager()).focusWorkbench();
  emitAppEvent("browser:focus-address-bar", bufferId);
}

export async function runActiveBrowserAction(
  action: "back" | "forward" | "reload" | "devtools",
): Promise<void> {
  const bufferId = getActiveBrowserBufferId();
  if (!bufferId) return;
  const manager = await loadBrowserTabManager();
  if (action === "devtools") {
    manager.openDevTools(bufferId);
  } else {
    manager.perform(bufferId, action);
  }
}

/** Zooms the active browser tab's page; returns false when no browser tab is active. */
export function zoomActiveBrowserTab(direction: -1 | 0 | 1): boolean {
  const bufferId = getActiveBrowserBufferId();
  if (!bufferId) return false;
  void loadBrowserTabManager().then((manager) => manager.zoom(bufferId, direction));
  return true;
}
