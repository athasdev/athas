import { Channel } from "@tauri-apps/api/core";
import { toast } from "sonner";
import {
  type BrowserBounds,
  type BrowserCapabilities,
  type BrowserEvent,
  commands,
} from "@/bindings/commands";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { keymapRegistry } from "@/features/keymaps/services/keymap-registry";
import type { BrowserContent } from "@/features/panes/types/pane-content.types";
import { getInternalTabDragData } from "@/features/tabs/services/internal-tab-drag";
import { useBrowserTabStore } from "../stores/browser-tab.store";
import type { BrowserPagePatch, BrowserPageStore } from "../types/browser-page.types";
import { getBrowserTabName, isBlankPage } from "./browser-address";
import { getBrowserKeyBindings, isPageCommand } from "../utils/browser-key-bindings";
import {
  type BrowserRect,
  getLocalHoles,
  getVisibleSlotGeometry,
  isRectCovered,
  isSlotShown,
  rectsKey,
  scanOverlays,
} from "../utils/browser-occlusion";
import { onAppEvent } from "@/utils/app-events";
import { frontendTrace } from "@/utils/frontend-trace";

const ZOOM_LEVELS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
/** Popups animate in after the input that opens them, so the layout is checked again after it. */
const SETTLE_DELAY_MS = 180;
/** Frames the layout is followed after it stops changing, so animations are tracked to the end. */
const STABLE_FRAMES = 2;
/** At most this many frames are followed after one trigger, so a looping animation can't spin. */
const MAX_TRACKED_FRAMES = 120;
/** The longest a page waits for its picture before it makes room for workbench UI anyway. */
const SNAPSHOT_TIMEOUT_MS = 150;
/** How long the picture stays under a page that came back, until the native page has drawn. */
const SNAPSHOT_LINGER_MS = 80;
const HIDDEN = "hidden";
const NO_CAPABILITIES: BrowserCapabilities = { holes: false, snapshots: false };

interface BrowserSlot {
  element: HTMLElement;
  /** Called when the page takes keyboard focus, so the pane holding the slot becomes active. */
  onFocus: () => void;
}

/** What a view last reported, applied to its page while the view is the page's primary one. */
interface ViewReport {
  url?: string;
  title?: string;
  favicon?: string | null;
  isLoading?: boolean;
  canGoBack?: boolean | null;
  canGoForward?: boolean | null;
}

/**
 * Where a view stands against workbench UI over it: `clear` shows the whole page, `capturing`
 * waits for a picture of the page to go under the UI, `covered` makes room for the UI.
 */
type Occlusion = "clear" | "capturing" | "covered";

/** One native webview, shown over one slot at a time. */
interface BrowserView {
  id: number;
  page: BrowserPage;
  slot: BrowserSlot | null;
  label: string | null;
  creating: boolean;
  closed: boolean;
  /** Address to load once the webview exists; views create their webview the first time they show. */
  pendingUrl: string | null;
  appliedLayout: string;
  occlusion: Occlusion;
  /** The picture under workbench UI over the page; the page makes room only once it is drawn. */
  snapshotUrl: string | null;
  report: ViewReport;
}

/**
 * A browser tab's page, or a page a host embeds. Each place that shows it at the same time, such
 * as a tab split into two panes, gets its own view; a view whose place goes away is kept for the
 * page's next place, so switching tabs keeps the page, its scroll position and form input.
 */
interface BrowserPage {
  pageId: string;
  workspaceId: string | null;
  /** Keeps the address of a page that has no buffer; tabs keep theirs on their buffer. */
  pageStore: BrowserPageStore | null;
  views: BrowserView[];
  /** The view whose address, title and history the page shows, and that page actions target. */
  primary: BrowserView | null;
}

interface MeasuredView {
  view: BrowserView;
  geometry: BrowserRect | null;
}

function getBufferStore(workspaceId: string | null) {
  return workspaceId ? useBufferStore.getStore(workspaceId) : useBufferStore;
}

function layoutKey(bounds: BrowserBounds | null, holes: readonly BrowserRect[]) {
  if (!bounds) return HIDDEN;
  return `${bounds.x}:${bounds.y}:${bounds.width}:${bounds.height}|${rectsKey(holes)}`;
}

function containsPoint(bounds: BrowserRect, point: { x: number; y: number }) {
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

function nextFrame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

function trace(view: BrowserView, message: string, payload: Record<string, unknown> = {}) {
  frontendTrace("info", "browser:occlusion", message, {
    page: view.page.pageId,
    view: view.id,
    label: view.label,
    ...payload,
  });
}

/**
 * Owns the native webviews behind every browser page of this window.
 *
 * A page's host registers the element it reserves for the page (its slot). The manager keeps a
 * webview over each slot, hides it while its slot is not shown, and creates it lazily the first
 * time the slot shows. Workbench UI over a page, such as a menu, toast or dialog, is measured on
 * every layout change; the native layer cuts it out of the page so the UI shows through, or hides
 * the page where it can't. Each webview is laid out on its own, so any number can show at once.
 */
class BrowserTabManager {
  private readonly pages = new Map<string, BrowserPage>();
  private readonly resizeObserver =
    typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => this.requestSync(true));
  private staleTabsCleanup: Promise<void> | null = null;
  private capabilities: BrowserCapabilities | null = null;
  private capabilitiesRequest: Promise<BrowserCapabilities> | null = null;
  private nextViewId = 0;
  private frame: number | null = null;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  private stopMonitoring: (() => void) | null = null;
  private dragging = false;
  private pointer: { x: number; y: number } | null = null;
  private sampleNext = true;
  private sampledLayers = new Set<Element>();
  private lastOverlayKey = "";
  private stableFrames = 0;
  private trackedFrames = 0;

  /** Closes webviews a previous load of this window left behind, such as after a reload. */
  cleanupStaleTabs(): Promise<void> {
    this.staleTabsCleanup ??= commands.browserCloseWindowTabs().then(
      () => undefined,
      (error) => console.warn("Failed to close stale browser tabs:", error),
    );
    return this.staleTabsCleanup;
  }

  attach(
    pageId: string,
    workspaceId: string | null,
    slot: BrowserSlot,
    initialUrl: string,
    pageStore: BrowserPageStore | null = null,
  ): () => void {
    const page = this.ensurePage(pageId, workspaceId);
    page.pageStore = pageStore;
    const view = this.takeIdleView(page) ?? this.createView(page);
    view.slot = slot;
    if (!view.label && !view.pendingUrl && !view.creating && !isBlankPage(initialUrl)) {
      view.pendingUrl = initialUrl;
    }
    this.setPrimary(view);
    this.resizeObserver?.observe(slot.element);
    this.startMonitoring();
    this.sampleNext = true;
    this.sync();

    return () => this.detach(view, slot);
  }

  navigate(pageId: string, url: string) {
    const page = this.pages.get(pageId);
    if (!page) return;
    this.updateBuffer(page, { url });
    useBrowserTabStore.getState().actions.patchTab(pageId, { error: null });
    let pending = false;
    for (const view of page.views) {
      view.report.url = url;
      if (view.label) {
        void commands.browserNavigate(view.label, url).catch((error) => this.fail(view, error));
      } else {
        view.pendingUrl = url;
        pending = true;
      }
    }
    if (pending) this.sync();
  }

  /** Runs a history action on the page; `from` is an element of the place that asked for it. */
  perform(pageId: string, action: "back" | "forward" | "reload" | "stop", from?: Element | null) {
    const page = this.pages.get(pageId);
    const view = page && this.targetView(page, from);
    if (!page || !view) return;
    if (view.label) {
      void commands.browserPerform(view.label, action).catch((error) => this.fail(view, error));
    } else if (action === "reload") {
      const buffer = this.getBuffer(page);
      if (buffer && !isBlankPage(buffer.url)) this.navigate(pageId, buffer.url);
    }
  }

  /** Steps the page zoom like a browser does, or resets it when `direction` is 0. */
  zoom(pageId: string, direction: -1 | 0 | 1) {
    const page = this.pages.get(pageId);
    const buffer = page && this.getBuffer(page);
    if (!page || !buffer) return;
    const current = buffer.zoom ?? 1;
    const next =
      direction === 0
        ? 1
        : direction > 0
          ? (ZOOM_LEVELS.find((level) => level > current + 0.001) ?? current)
          : ([...ZOOM_LEVELS].reverse().find((level) => level < current - 0.001) ?? current);
    this.updateBuffer(page, { zoom: next === 1 ? undefined : next });
    for (const view of page.views) {
      if (!view.label) continue;
      void commands.browserSetZoom(view.label, next).catch((error) => this.fail(view, error));
    }
  }

  focusPage(pageId: string, from?: Element | null) {
    const page = this.pages.get(pageId);
    const view = page && this.targetView(page, from);
    if (view?.label) void commands.browserFocus(view.label).catch(() => {});
  }

  openDevTools(pageId: string, from?: Element | null) {
    const page = this.pages.get(pageId);
    const view = page && this.targetView(page, from);
    if (!view?.label) return;
    void commands.browserOpenDevtools(view.label).catch((error) => {
      toast.error(error instanceof Error ? error.message : String(error));
    });
  }

  async clearBrowsingData(pageId: string, from?: Element | null) {
    const page = this.pages.get(pageId);
    const label = page && this.targetView(page, from)?.label;
    if (!label) return;
    try {
      await commands.browserClearData(label);
      toast.success("Cleared browsing data");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }

  close(pageId: string) {
    const page = this.pages.get(pageId);
    if (!page) return;
    this.pages.delete(pageId);
    for (const view of page.views) this.destroyView(view);
    if (useBrowserTabStore.getState().focusedBufferId === pageId) void this.focusWorkbench();
    useBrowserTabStore.getState().actions.removeTab(pageId);
    this.updateMonitoring();
  }

  /** Moves keyboard focus from a page back to the workbench. */
  async focusWorkbench() {
    useBrowserTabStore.getState().actions.setFocusedBufferId(null);
    await commands.browserFocusWorkbench().catch(() => {});
  }

  private ensurePage(pageId: string, workspaceId: string | null): BrowserPage {
    let page = this.pages.get(pageId);
    if (!page) {
      page = { pageId, workspaceId, pageStore: null, views: [], primary: null };
      this.pages.set(pageId, page);
    }
    return page;
  }

  private createView(page: BrowserPage): BrowserView {
    const view: BrowserView = {
      id: this.nextViewId++,
      page,
      slot: null,
      label: null,
      creating: false,
      closed: false,
      pendingUrl: null,
      appliedLayout: HIDDEN,
      occlusion: "clear",
      snapshotUrl: null,
      report: {},
    };
    page.views.push(view);
    return view;
  }

  /** A view of the page that no place shows, preferring the one the page last showed. */
  private takeIdleView(page: BrowserPage): BrowserView | null {
    if (page.primary && !page.primary.slot) return page.primary;
    return page.views.find((view) => !view.slot) ?? null;
  }

  private targetView(page: BrowserPage, from?: Element | null): BrowserView | null {
    const owner = from ? page.views.find((view) => view.slot?.element.contains(from)) : null;
    if (owner) {
      this.setPrimary(owner);
      return owner;
    }
    return page.primary ?? page.views[0] ?? null;
  }

  /** Makes `view` the one its page follows, and brings the page up to date with it. */
  private setPrimary(view: BrowserView) {
    const page = view.page;
    if (page.primary === view) return;
    page.primary = view;
    const { url, title, favicon, ...state } = view.report;
    const patch: BrowserPagePatch = {};
    if (url !== undefined) patch.url = url;
    if (title !== undefined)
      patch.name = getBrowserTabName(url ?? this.getBuffer(page)?.url ?? "", title);
    if (favicon !== undefined) patch.favicon = favicon ?? undefined;
    if (Object.keys(patch).length > 0) this.updateBuffer(page, patch);
    const known = Object.fromEntries(
      Object.entries(state).filter(([, value]) => value !== undefined),
    );
    if (Object.keys(known).length > 0) {
      useBrowserTabStore.getState().actions.patchTab(page.pageId, known);
    }
  }

  private detach(view: BrowserView, slot: BrowserSlot) {
    if (view.slot !== slot) return;
    this.resizeObserver?.unobserve(slot.element);
    view.slot = null;
    const page = view.page;
    if (useBrowserTabStore.getState().focusedBufferId === page.pageId) {
      const stillFocused = page.views.some((other) => other !== view && other.slot);
      if (!stillFocused) void this.focusWorkbench();
    }
    // A page keeps one idle view for its next place, the one it follows; more would only hold
    // memory.
    const otherIdle = page.views.find((other) => other !== view && !other.slot);
    if (otherIdle && page.primary !== view) {
      this.destroyView(view);
    } else {
      if (otherIdle) this.destroyView(otherIdle);
      this.applyLayout(view, null, []);
      this.clearSnapshot(view);
      view.occlusion = "clear";
    }
    if (page.primary === view) {
      const shown = page.views.find((other) => other.slot);
      if (shown) this.setPrimary(shown);
    }
    this.updateMonitoring();
  }

  private destroyView(view: BrowserView) {
    view.closed = true;
    if (view.slot) this.resizeObserver?.unobserve(view.slot.element);
    view.slot = null;
    this.clearSnapshot(view);
    const page = view.page;
    page.views = page.views.filter((other) => other !== view);
    if (page.primary === view) page.primary = page.views[0] ?? null;
    if (view.label) void commands.browserClose(view.label).catch(() => {});
  }

  private getBuffer(page: BrowserPage): Pick<BrowserContent, "url" | "zoom"> | null {
    if (page.pageStore) return page.pageStore.read();
    const buffer = getBufferStore(page.workspaceId)
      .getState()
      .buffers.find((candidate) => candidate.id === page.pageId);
    return buffer?.type === "browser" ? buffer : null;
  }

  private updateBuffer(page: BrowserPage, patch: BrowserPagePatch) {
    if (page.pageStore) {
      page.pageStore.update(patch);
      return;
    }
    getBufferStore(page.workspaceId).getState().actions.updateBrowserBuffer(page.pageId, patch);
  }

  private fail(view: BrowserView, error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    useBrowserTabStore
      .getState()
      .actions.patchTab(view.page.pageId, { error: message, isLoading: false });
  }

  private loadCapabilities(): Promise<BrowserCapabilities> {
    this.capabilitiesRequest ??= Promise.resolve()
      .then(() => commands.browserCapabilities())
      .then(
        (capabilities) => (this.capabilities = capabilities),
        // An older native layer without the command: hide pages under workbench UI.
        () => (this.capabilities = NO_CAPABILITIES),
      );
    return this.capabilitiesRequest;
  }

  /** Lays the views out on the next frame; `sample` also hit tests in-app UI over the pages. */
  private requestSync(sample: boolean) {
    if (sample) this.sampleNext = true;
    this.trackedFrames = 0;
    this.scheduleFrame();
  }

  private scheduleFrame() {
    if (this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.sync();
    });
  }

  private requestSettledSync = () => {
    this.requestSync(true);
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null;
      this.requestSync(true);
    }, SETTLE_DELAY_MS);
  };

  private views(): BrowserView[] {
    return [...this.pages.values()].flatMap((page) => page.views);
  }

  private measure(): MeasuredView[] {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    return this.views().map((view) => {
      const element = view.slot?.element;
      const geometry =
        element && isSlotShown(element)
          ? getVisibleSlotGeometry(element.getBoundingClientRect(), viewport)
          : null;
      return { view, geometry };
    });
  }

  private sync() {
    const measured = this.measure();
    const shown = measured.filter(
      (entry): entry is MeasuredView & { geometry: BrowserRect } =>
        entry.geometry !== null && entry.view.slot !== null,
    );
    const scan =
      shown.length > 0
        ? scanOverlays(
            shown.map((entry) => ({
              element: (entry.view.slot as BrowserSlot).element,
              geometry: entry.geometry,
            })),
            this.sampleNext,
            this.sampledLayers,
          )
        : { rects: [], layers: new Set<Element>() };
    this.sampleNext = false;
    this.sampledLayers = scan.layers;
    // A tab dragged over a page shows the pane's drop zones there, so only that page steps aside.
    const dragPoint = getInternalTabDragData() ? this.pointer : null;
    const capabilities = this.capabilities ?? NO_CAPABILITIES;

    for (const { view, geometry } of measured) {
      if (!geometry || !view.slot) {
        if (view.label) this.applyLayout(view, null, []);
        this.reveal(view);
        continue;
      }
      const whole = { x: 0, y: 0, width: geometry.width, height: geometry.height };
      const holes =
        this.dragging || (dragPoint !== null && containsPoint(geometry, dragPoint))
          ? [whole]
          : getLocalHoles(geometry, scan.rects);
      const hidden = holes.length > 0 && (!capabilities.holes || isRectCovered(whole, holes));

      if (!view.label) {
        if (!hidden && view.pendingUrl && !view.creating) void this.create(view, geometry);
        continue;
      }
      if (holes.length === 0) {
        this.applyLayout(view, geometry, []);
        this.reveal(view);
        continue;
      }
      if (view.occlusion === "capturing") continue;
      if (view.occlusion === "clear" && capabilities.snapshots && view.appliedLayout !== HIDDEN) {
        void this.captureSnapshot(view);
        continue;
      }
      if (view.occlusion !== "covered") {
        view.occlusion = "covered";
        trace(view, hidden ? "hidden under workbench UI" : "cut around workbench UI", {
          holes: holes.length,
        });
      }
      this.applyLayout(view, hidden ? null : geometry, hidden ? [] : holes);
    }

    this.followAnimations(rectsKey(scan.rects), shown.length > 0);
  }

  /** Keeps laying out on every frame while the UI over pages moves, such as a toast sliding in. */
  private followAnimations(overlayKey: string, hasSlots: boolean) {
    if (overlayKey !== this.lastOverlayKey) {
      this.lastOverlayKey = overlayKey;
      this.stableFrames = 0;
    } else {
      this.stableFrames += 1;
    }
    this.trackedFrames += 1;
    if (hasSlots && this.stableFrames < STABLE_FRAMES && this.trackedFrames < MAX_TRACKED_FRAMES) {
      this.scheduleFrame();
    }
  }

  /** Shows the whole page again once nothing covers it. */
  private reveal(view: BrowserView) {
    if (view.occlusion === "clear") return;
    view.occlusion = "clear";
    trace(view, "uncovered");
    if (!view.snapshotUrl) return;
    // The picture goes once the native page has drawn over it again.
    setTimeout(() => {
      if (view.occlusion === "clear") this.clearSnapshot(view);
    }, SNAPSHOT_LINGER_MS);
  }

  /** Puts a picture of the page in its slot, then lets {@link sync} make room in the page. */
  private async captureSnapshot(view: BrowserView) {
    if (!view.label || !view.slot) return;
    view.occlusion = "capturing";
    const slot = view.slot;
    let url: string | null = null;
    try {
      const bytes = await Promise.race([
        commands.browserSnapshot(view.label),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("timed out")), SNAPSHOT_TIMEOUT_MS),
        ),
      ]);
      url = URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" }));
      const image = new Image();
      image.src = url;
      await image.decode();
    } catch {
      if (url) URL.revokeObjectURL(url);
      url = null;
    }
    if (view.closed || view.occlusion !== "capturing" || view.slot !== slot) {
      if (url) URL.revokeObjectURL(url);
      if (view.occlusion === "capturing") view.occlusion = "clear";
      return;
    }
    if (url) {
      this.clearSnapshot(view);
      view.snapshotUrl = url;
      slot.element.style.backgroundImage = `url("${url}")`;
      slot.element.style.backgroundSize = "100% 100%";
      await nextFrame();
      await nextFrame();
      if (view.occlusion !== "capturing") return;
    }
    view.occlusion = "covered";
    trace(view, "picture shown under workbench UI", { picture: url !== null });
    this.sync();
  }

  private clearSnapshot(view: BrowserView) {
    if (!view.snapshotUrl) return;
    URL.revokeObjectURL(view.snapshotUrl);
    view.snapshotUrl = null;
    const element = view.slot?.element;
    if (element) {
      element.style.backgroundImage = "";
      element.style.backgroundSize = "";
    }
  }

  private applyLayout(view: BrowserView, bounds: BrowserBounds | null, holes: BrowserRect[]) {
    const key = layoutKey(bounds, holes);
    if (!view.label || key === view.appliedLayout) return;
    const wasHidden = view.appliedLayout === HIDDEN;
    view.appliedLayout = key;
    if (!bounds && !wasHidden) trace(view, "hidden");
    void commands
      .browserSetBounds(view.label, bounds, bounds && holes.length > 0 ? holes : null)
      .catch((error) => this.fail(view, error));
  }

  private async create(view: BrowserView, bounds: BrowserBounds) {
    const url = view.pendingUrl;
    if (!url) return;
    const page = view.page;
    view.creating = true;
    view.pendingUrl = null;
    const { patchTab } = useBrowserTabStore.getState().actions;
    patchTab(page.pageId, { isLoading: true, error: null });

    const events = new Channel<BrowserEvent>();
    events.onmessage = (event) => this.handleEvent(view, event);

    try {
      await Promise.all([this.cleanupStaleTabs(), this.loadCapabilities()]);
      const label = await commands.browserCreate(
        {
          url,
          bounds,
          zoom: this.getBuffer(page)?.zoom ?? null,
          cornerRadius: view.slot ? getCornerRadius(view.slot.element) : null,
          keyBindings: getBrowserKeyBindings(),
        },
        events,
      );
      if (view.closed) {
        void commands.browserClose(label).catch(() => {});
        return;
      }
      view.label = label;
      view.appliedLayout = layoutKey(bounds, []);
      this.requestSync(true);
      this.sync();
    } catch (error) {
      view.pendingUrl = url;
      this.fail(view, error);
    } finally {
      view.creating = false;
    }
  }

  private handleEvent(view: BrowserView, event: BrowserEvent) {
    if (view.closed) return;
    const page = view.page;
    const isPrimary = page.primary === view;
    const { patchTab, setFocusedBufferId } = useBrowserTabStore.getState().actions;

    switch (event.event) {
      case "loadStarted":
        view.report.isLoading = true;
        view.report.url = event.url;
        if (!isPrimary) break;
        patchTab(page.pageId, { isLoading: true, error: null });
        this.updateBuffer(page, { url: event.url });
        break;
      case "loadFinished":
        view.report.isLoading = false;
        if (isPrimary) patchTab(page.pageId, { isLoading: false });
        break;
      case "urlChanged":
        view.report.url = event.url;
        if (event.canGoBack !== null || event.canGoForward !== null) {
          view.report.canGoBack = event.canGoBack;
          view.report.canGoForward = event.canGoForward;
        }
        if (!isPrimary) break;
        this.updateBuffer(page, { url: event.url });
        if (event.canGoBack !== null || event.canGoForward !== null) {
          patchTab(page.pageId, {
            canGoBack: event.canGoBack,
            canGoForward: event.canGoForward,
          });
        }
        break;
      case "titleChanged": {
        view.report.title = event.title;
        if (!isPrimary) break;
        const url = this.getBuffer(page)?.url ?? "";
        this.updateBuffer(page, { name: getBrowserTabName(url, event.title) });
        break;
      }
      case "faviconChanged":
        view.report.favicon = event.url;
        if (isPrimary) this.updateBuffer(page, { favicon: event.url ?? undefined });
        break;
      case "focused":
        this.setPrimary(view);
        setFocusedBufferId(page.pageId);
        view.slot?.onFocus();
        if (view.occlusion === "covered" && view.appliedLayout !== HIDDEN) {
          dismissWorkbenchPopups();
        }
        break;
      case "shortcut":
        void this.runShortcut(event.command);
        break;
      case "openInNewTab":
        getBufferStore(page.workspaceId).getState().actions.openBrowserBuffer(event.url);
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
      this.requestSync(false);
      this.sync();
    };
    const onDragEnd = () => {
      this.dragging = false;
      this.requestSettledSync();
    };
    const onWindowFocus = () => useBrowserTabStore.getState().actions.setFocusedBufferId(null);
    const onPointerMove = (event: Event) => {
      if (!getInternalTabDragData()) return;
      const { clientX, clientY } = event as PointerEvent;
      this.pointer = { x: clientX, y: clientY };
      this.requestSync(false);
    };
    const onLayoutChange = () => this.requestSync(true);
    const onAnimationStart = () => this.requestSync(false);
    // Popups mount and open in portals next to the app root, and toasts in their own host inside
    // it. Other changes inside the app, such as typing in an editor, can't open one and are
    // ignored.
    const appRoot = document.getElementById("root");
    const overlayHost = (node: Node) => {
      const element = node instanceof Element ? node : node.parentElement;
      return element?.closest("[data-sonner-toaster], section[aria-live], [data-browser-occluder]");
    };
    const mutationObserver = new MutationObserver((records) => {
      if (
        records.some((record) => !appRoot?.contains(record.target) || overlayHost(record.target))
      ) {
        this.requestSettledSync();
      }
    });
    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        "data-open",
        "data-closed",
        "data-starting-style",
        "data-ending-style",
        "data-expanded",
        "hidden",
      ],
    });

    const listeners: [EventTarget, string, EventListener, boolean][] = [
      [window, "resize", onLayoutChange, false],
      [window, "scroll", onLayoutChange, true],
      [window, "pointerdown", this.requestSettledSync, true],
      [window, "pointerup", this.requestSettledSync, true],
      [window, "contextmenu", this.requestSettledSync, true],
      [window, "transitionrun", onAnimationStart, true],
      [window, "animationstart", onAnimationStart, true],
      [window, "transitionend", onLayoutChange, true],
      [window, "animationend", onLayoutChange, true],
      [window, "pointermove", onPointerMove, true],
      [window, "dragstart", onDragStart, true],
      [window, "dragend", onDragEnd, true],
      [window, "drop", onDragEnd, true],
      [window, "focus", onWindowFocus, false],
    ];
    for (const [target, type, listener, capture] of listeners) {
      target.addEventListener(type, listener, capture);
    }
    const stopTabDragHover = onAppEvent("tabs:internal-drag-hover", () => this.requestSync(false));

    this.stopMonitoring = () => {
      mutationObserver.disconnect();
      stopTabDragHover();
      for (const [target, type, listener, capture] of listeners) {
        target.removeEventListener(type, listener, capture);
      }
      if (this.settleTimer) clearTimeout(this.settleTimer);
      this.settleTimer = null;
    };
  }

  private updateMonitoring() {
    const hasSlots = this.views().some((view) => view.slot);
    if (hasSlots || !this.stopMonitoring) return;
    this.stopMonitoring();
    this.stopMonitoring = null;
    this.dragging = false;
    this.sampledLayers = new Set();
  }
}

/**
 * Closes workbench popups after a click into a page. A click on the page never reaches the
 * workbench, so a menu open over part of the page would otherwise stay open.
 */
function dismissWorkbenchPopups() {
  const target = document.body;
  const init = { bubbles: true, cancelable: true, composed: true, button: 0 };
  const PointerEventClass = typeof PointerEvent === "undefined" ? MouseEvent : PointerEvent;
  target.dispatchEvent(new PointerEventClass("pointerdown", init));
  target.dispatchEvent(new MouseEvent("mousedown", init));
  target.dispatchEvent(new PointerEventClass("pointerup", init));
  target.dispatchEvent(new MouseEvent("mouseup", init));
  target.dispatchEvent(new MouseEvent("click", init));
}

export const browserTabManager = new BrowserTabManager();
