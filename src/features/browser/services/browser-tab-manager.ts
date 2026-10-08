import { Channel } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { type BrowserBounds, type BrowserEvent, commands } from "@/bindings/commands";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { keymapRegistry } from "@/features/keymaps/services/keymap-registry";
import type { BrowserContent } from "@/features/panes/types/pane-content.types";
import { getInternalTabDragData } from "@/features/tabs/services/internal-tab-drag";
import { useBrowserTabStore } from "../stores/browser-tab.store";
import { getBrowserTabName, isBlankPage } from "./browser-address";
import { getBrowserKeyBindings, isPageCommand } from "../utils/browser-key-bindings";
import {
  type BrowserSlotGeometry,
  getVisibleSlotGeometry,
  isSlotOccluded,
} from "../utils/browser-occlusion";
import { onAppEvent } from "@/utils/app-events";

const ZOOM_LEVELS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
/** Popups animate in after the input that opens them, so the layout is checked again after it. */
const SETTLE_DELAY_MS = 180;
const HIDDEN = "hidden";

interface BrowserSlot {
  element: HTMLElement;
  /** Called when the page takes keyboard focus, so the pane holding the slot becomes active. */
  onFocus: () => void;
}

interface BrowserTab {
  bufferId: string;
  workspaceId: string | null;
  label: string | null;
  creating: boolean;
  closed: boolean;
  /** Address to load once the webview exists; tabs create their webview the first time they show. */
  pendingUrl: string | null;
  slot: BrowserSlot | null;
  appliedBounds: string;
  /**
   * The picture that stands in for the page while workbench UI covers it. The native page hides
   * only once the picture is on screen, so the tab never flashes empty.
   */
  snapshot: "none" | "capturing" | "shown";
  snapshotUrl: string | null;
}

function getBufferStore(workspaceId: string | null) {
  return workspaceId ? useBufferStore.getStore(workspaceId) : useBufferStore;
}

function boundsKey(bounds: BrowserBounds | null) {
  return bounds ? `${bounds.x}:${bounds.y}:${bounds.width}:${bounds.height}` : HIDDEN;
}

function containsPoint(bounds: BrowserSlotGeometry, point: { x: number; y: number }) {
  return (
    point.x >= bounds.x &&
    point.x <= bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y <= bounds.y + bounds.height
  );
}

function getCornerRadius(element: HTMLElement) {
  const radius = Number.parseFloat(getComputedStyle(element).borderTopLeftRadius);
  return Number.isFinite(radius) && radius > 0 ? radius : null;
}

function fileNameOf(path: string) {
  return path.split(/[\\/]/).pop() || path;
}

/**
 * Owns the native webview behind every browser tab of this window.
 *
 * A tab's view registers the element it reserves for the page (its slot); the manager keeps the
 * webview over that slot, hides it while the tab is not shown or workbench UI covers it, and
 * creates it lazily the first time the tab shows. Webviews outlive their view, so switching tabs
 * keeps the page, its scroll position and any form input.
 */
class BrowserTabManager {
  private readonly tabs = new Map<string, BrowserTab>();
  private readonly resizeObserver =
    typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => this.scheduleSync());
  private staleTabsCleanup: Promise<void> | null = null;
  private frame: number | null = null;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  private stopMonitoring: (() => void) | null = null;
  private dragging = false;
  private pointer: { x: number; y: number } | null = null;

  /** Closes webviews a previous load of this window left behind, such as after a reload. */
  cleanupStaleTabs(): Promise<void> {
    this.staleTabsCleanup ??= commands.browserCloseWindowTabs().then(
      () => undefined,
      (error) => console.warn("Failed to close stale browser tabs:", error),
    );
    return this.staleTabsCleanup;
  }

  attach(
    bufferId: string,
    workspaceId: string | null,
    slot: BrowserSlot,
    initialUrl: string,
  ): () => void {
    const tab = this.ensureTab(bufferId, workspaceId);
    if (tab.slot) this.resizeObserver?.unobserve(tab.slot.element);
    tab.slot = slot;
    if (!tab.label && !tab.pendingUrl && !isBlankPage(initialUrl)) {
      tab.pendingUrl = initialUrl;
    }
    this.resizeObserver?.observe(slot.element);
    this.startMonitoring();
    this.sync();

    return () => this.detach(bufferId, slot);
  }

  navigate(bufferId: string, url: string) {
    const tab = this.tabs.get(bufferId);
    if (!tab) return;
    this.updateBuffer(tab, { url });
    useBrowserTabStore.getState().actions.patchTab(bufferId, { error: null });
    if (tab.label) {
      void commands.browserNavigate(tab.label, url).catch((error) => this.fail(tab, error));
    } else {
      tab.pendingUrl = url;
      this.sync();
    }
  }

  perform(bufferId: string, action: "back" | "forward" | "reload" | "stop") {
    const tab = this.tabs.get(bufferId);
    if (tab?.label) {
      void commands.browserPerform(tab.label, action).catch((error) => this.fail(tab, error));
    } else if (tab && action === "reload") {
      const buffer = this.getBuffer(tab);
      if (buffer && !isBlankPage(buffer.url)) this.navigate(bufferId, buffer.url);
    }
  }

  /** Steps the page zoom like a browser does, or resets it when `direction` is 0. */
  zoom(bufferId: string, direction: -1 | 0 | 1) {
    const tab = this.tabs.get(bufferId);
    const buffer = tab && this.getBuffer(tab);
    if (!tab || !buffer) return;
    const current = buffer.zoom ?? 1;
    const next =
      direction === 0
        ? 1
        : direction > 0
          ? (ZOOM_LEVELS.find((level) => level > current + 0.001) ?? current)
          : ([...ZOOM_LEVELS].reverse().find((level) => level < current - 0.001) ?? current);
    this.updateBuffer(tab, { zoom: next === 1 ? undefined : next });
    if (tab.label) {
      void commands.browserSetZoom(tab.label, next).catch((error) => this.fail(tab, error));
    }
  }

  focusPage(bufferId: string) {
    const label = this.tabs.get(bufferId)?.label;
    if (label) void commands.browserFocus(label).catch(() => {});
  }

  openDevTools(bufferId: string) {
    const tab = this.tabs.get(bufferId);
    if (!tab?.label) return;
    void commands.browserOpenDevtools(tab.label).catch((error) => {
      toast.error(error instanceof Error ? error.message : String(error));
    });
  }

  async clearBrowsingData(bufferId: string) {
    const label = this.tabs.get(bufferId)?.label;
    if (!label) return;
    try {
      await commands.browserClearData(label);
      toast.success("Cleared browsing data");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }

  close(bufferId: string) {
    const tab = this.tabs.get(bufferId);
    if (!tab) return;
    tab.closed = true;
    if (tab.slot) this.resizeObserver?.unobserve(tab.slot.element);
    this.tabs.delete(bufferId);
    this.clearSnapshot(tab);
    if (tab.label) void commands.browserClose(tab.label).catch(() => {});
    if (useBrowserTabStore.getState().focusedBufferId === bufferId) void this.focusWorkbench();
    useBrowserTabStore.getState().actions.removeTab(bufferId);
    this.updateMonitoring();
  }

  /** Moves keyboard focus from a page back to the workbench. */
  async focusWorkbench() {
    useBrowserTabStore.getState().actions.setFocusedBufferId(null);
    await commands.browserFocusWorkbench().catch(() => {});
  }

  private detach(bufferId: string, slot: BrowserSlot) {
    const tab = this.tabs.get(bufferId);
    if (!tab || tab.slot !== slot) return;
    this.resizeObserver?.unobserve(slot.element);
    tab.slot = null;
    this.applyBounds(tab, null);
    this.clearSnapshot(tab);
    if (useBrowserTabStore.getState().focusedBufferId === bufferId) void this.focusWorkbench();
    this.updateMonitoring();
  }

  private ensureTab(bufferId: string, workspaceId: string | null): BrowserTab {
    let tab = this.tabs.get(bufferId);
    if (!tab) {
      tab = {
        bufferId,
        workspaceId,
        label: null,
        creating: false,
        closed: false,
        pendingUrl: null,
        slot: null,
        appliedBounds: HIDDEN,
        snapshot: "none",
        snapshotUrl: null,
      };
      this.tabs.set(bufferId, tab);
    }
    return tab;
  }

  private getBuffer(tab: BrowserTab): BrowserContent | null {
    const buffer = getBufferStore(tab.workspaceId)
      .getState()
      .buffers.find((candidate) => candidate.id === tab.bufferId);
    return buffer?.type === "browser" ? buffer : null;
  }

  private updateBuffer(
    tab: BrowserTab,
    patch: Partial<Pick<BrowserContent, "url" | "name" | "favicon" | "zoom">>,
  ) {
    getBufferStore(tab.workspaceId).getState().actions.updateBrowserBuffer(tab.bufferId, patch);
  }

  private fail(tab: BrowserTab, error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    useBrowserTabStore
      .getState()
      .actions.patchTab(tab.bufferId, { error: message, isLoading: false });
  }

  private scheduleSync = () => {
    if (this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.sync();
    });
  };

  private scheduleSettledSync = () => {
    this.scheduleSync();
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null;
      this.sync();
    }, SETTLE_DELAY_MS);
  };

  private sync() {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    // A tab dragged over a page shows the pane's drop zones there, so only that page steps aside.
    const dragPoint = getInternalTabDragData() ? this.pointer : null;

    for (const tab of this.tabs.values()) {
      const geometry = tab.slot
        ? getVisibleSlotGeometry(tab.slot.element.getBoundingClientRect(), viewport)
        : null;
      const covered =
        geometry !== null &&
        (this.dragging ||
          (dragPoint !== null && containsPoint(geometry, dragPoint)) ||
          (tab.slot !== null && isSlotOccluded(tab.slot.element, geometry)));

      if (!tab.label) {
        if (geometry && !covered && tab.pendingUrl && !tab.creating)
          void this.create(tab, geometry);
      } else if (!geometry) {
        this.applyBounds(tab, null);
        this.clearSnapshot(tab);
      } else if (covered) {
        if (tab.snapshot === "shown") {
          this.applyBounds(tab, null);
        } else if (tab.snapshot === "none" && tab.appliedBounds !== HIDDEN) {
          void this.captureSnapshot(tab);
        }
      } else {
        this.applyBounds(tab, geometry);
        // The page draws over the picture once shown, so the picture goes a frame later.
        if (tab.snapshot === "shown") {
          requestAnimationFrame(() => {
            if (tab.appliedBounds !== HIDDEN) this.clearSnapshot(tab);
          });
        }
      }
    }
  }

  /** Puts a picture of the page in its slot, then lets {@link sync} hide the page behind it. */
  private async captureSnapshot(tab: BrowserTab) {
    if (!tab.label) return;
    tab.snapshot = "capturing";
    let url: string | null = null;
    try {
      const bytes = await commands.browserSnapshot(tab.label);
      url = URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" }));
      const image = new Image();
      image.src = url;
      await image.decode();
    } catch {
      if (url) URL.revokeObjectURL(url);
      url = null;
    }
    if (tab.closed || tab.snapshot !== "capturing") {
      if (url) URL.revokeObjectURL(url);
      return;
    }
    tab.snapshotUrl = url;
    useBrowserTabStore.getState().actions.patchTab(tab.bufferId, { snapshotUrl: url });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (tab.snapshot !== "capturing") return;
    tab.snapshot = "shown";
    this.sync();
  }

  private clearSnapshot(tab: BrowserTab) {
    if (tab.snapshot === "none") return;
    tab.snapshot = "none";
    if (tab.snapshotUrl) URL.revokeObjectURL(tab.snapshotUrl);
    tab.snapshotUrl = null;
    if (!tab.closed) {
      useBrowserTabStore.getState().actions.patchTab(tab.bufferId, { snapshotUrl: null });
    }
  }

  private applyBounds(tab: BrowserTab, bounds: BrowserBounds | null) {
    const key = boundsKey(bounds);
    if (!tab.label || key === tab.appliedBounds) return;
    tab.appliedBounds = key;
    void commands.browserSetBounds(tab.label, bounds).catch((error) => this.fail(tab, error));
  }

  private async create(tab: BrowserTab, bounds: BrowserBounds) {
    const url = tab.pendingUrl;
    if (!url) return;
    tab.creating = true;
    tab.pendingUrl = null;
    const { patchTab } = useBrowserTabStore.getState().actions;
    patchTab(tab.bufferId, { isLoading: true, error: null });

    const events = new Channel<BrowserEvent>();
    events.onmessage = (event) => this.handleEvent(tab, event);

    try {
      await this.cleanupStaleTabs();
      const label = await commands.browserCreate(
        {
          url,
          bounds,
          zoom: this.getBuffer(tab)?.zoom ?? null,
          cornerRadius: tab.slot ? getCornerRadius(tab.slot.element) : null,
          keyBindings: getBrowserKeyBindings(),
        },
        events,
      );
      if (tab.closed) {
        void commands.browserClose(label).catch(() => {});
        return;
      }
      tab.label = label;
      tab.appliedBounds = boundsKey(bounds);
      this.sync();
    } catch (error) {
      tab.pendingUrl = url;
      this.fail(tab, error);
    } finally {
      tab.creating = false;
    }
  }

  private handleEvent(tab: BrowserTab, event: BrowserEvent) {
    if (tab.closed) return;
    const { patchTab, setFocusedBufferId } = useBrowserTabStore.getState().actions;

    switch (event.event) {
      case "loadStarted":
        patchTab(tab.bufferId, { isLoading: true, error: null });
        this.updateBuffer(tab, { url: event.url });
        break;
      case "loadFinished":
        patchTab(tab.bufferId, { isLoading: false });
        break;
      case "urlChanged":
        this.updateBuffer(tab, { url: event.url });
        if (event.canGoBack !== null || event.canGoForward !== null) {
          patchTab(tab.bufferId, {
            canGoBack: event.canGoBack,
            canGoForward: event.canGoForward,
          });
        }
        break;
      case "titleChanged": {
        const url = this.getBuffer(tab)?.url ?? "";
        this.updateBuffer(tab, { name: getBrowserTabName(url, event.title) });
        break;
      }
      case "faviconChanged":
        this.updateBuffer(tab, { favicon: event.url ?? undefined });
        break;
      case "focused":
        setFocusedBufferId(tab.bufferId);
        tab.slot?.onFocus();
        break;
      case "shortcut":
        void this.runShortcut(event.command);
        break;
      case "openInNewTab":
        getBufferStore(tab.workspaceId).getState().actions.openBrowserBuffer(event.url);
        break;
      case "downloadStarted":
        toast(`Downloading ${fileNameOf(event.path)}`);
        break;
      case "downloadFinished":
        if (event.success) {
          const path = event.path;
          toast.success(path ? `Downloaded ${fileNameOf(path)}` : "Download finished", {
            action: path
              ? {
                  label: "Show",
                  onClick: () => {
                    void import("@tauri-apps/plugin-opener").then(({ revealItemInDir }) =>
                      revealItemInDir(path),
                    );
                  },
                }
              : undefined,
          });
        } else {
          toast.error("Download failed");
        }
        break;
    }
  }

  private async runShortcut(command: string) {
    if (!isPageCommand(command)) await this.focusWorkbench();
    await keymapRegistry.executeCommand(command);
  }

  private startMonitoring() {
    if (this.stopMonitoring) return;

    const onDragStart = () => {
      this.dragging = true;
      this.sync();
    };
    const onDragEnd = () => {
      this.dragging = false;
      this.scheduleSettledSync();
    };
    const onWindowFocus = () => useBrowserTabStore.getState().actions.setFocusedBufferId(null);
    const onPointerMove = (event: Event) => {
      if (!getInternalTabDragData()) return;
      const { clientX, clientY } = event as PointerEvent;
      this.pointer = { x: clientX, y: clientY };
      this.scheduleSync();
    };
    // Popups mount and open inside portals next to the app root; changes inside the app itself,
    // such as typing in an editor, can't open one and are ignored.
    const appRoot = document.getElementById("root");
    const mutationObserver = new MutationObserver((records) => {
      if (records.some((record) => !appRoot?.contains(record.target))) {
        this.scheduleSettledSync();
      }
    });
    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-open", "hidden"],
    });

    const listeners: [EventTarget, string, EventListener, boolean][] = [
      [window, "resize", this.scheduleSync, false],
      [window, "scroll", this.scheduleSync, true],
      [window, "pointerdown", this.scheduleSettledSync, true],
      [window, "pointerup", this.scheduleSettledSync, true],
      [window, "keydown", this.scheduleSettledSync, true],
      [window, "keyup", this.scheduleSettledSync, true],
      [window, "contextmenu", this.scheduleSettledSync, true],
      [window, "transitionend", this.scheduleSync, true],
      [window, "animationend", this.scheduleSync, true],
      [window, "pointermove", onPointerMove, true],
      [window, "dragstart", onDragStart, true],
      [window, "dragend", onDragEnd, true],
      [window, "drop", onDragEnd, true],
      [window, "focus", onWindowFocus, false],
    ];
    for (const [target, type, listener, capture] of listeners) {
      target.addEventListener(type, listener, capture);
    }
    const stopTabDragHover = onAppEvent("tabs:internal-drag-hover", this.scheduleSync);

    this.stopMonitoring = () => {
      mutationObserver.disconnect();
      stopTabDragHover();
      for (const [target, type, listener, capture] of listeners) {
        target.removeEventListener(type, listener, capture);
      }
    };
  }

  private updateMonitoring() {
    const hasSlots = [...this.tabs.values()].some((tab) => tab.slot);
    if (hasSlots || !this.stopMonitoring) return;
    this.stopMonitoring();
    this.stopMonitoring = null;
    this.dragging = false;
  }
}

export const browserTabManager = new BrowserTabManager();
