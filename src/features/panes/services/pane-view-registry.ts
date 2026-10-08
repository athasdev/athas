import { type ComponentType, createElement, type ReactElement } from "react";
import type { PaneContent, PaneContentType } from "../types/pane-content.types";

/**
 * The views buffers render with, contributed by the features that own each buffer type. A feature
 * registers its views from its registration module (`<feature>/services/<feature>-views.ts`), which
 * the window entry runs once before it renders: the workbench through
 * `bootstrap/services/register-workbench-views.ts`, detached windows for the types they show.
 *
 * Registration modules reference views through `lazy()`, so a view's code still loads the first
 * time a buffer of its type shows. A type without a registered view renders in the code editor.
 */

export type PaneViewBuffer<T extends PaneContentType> = Extract<PaneContent, { type: T }>;

/** Where a view renders. The fields are absent in a detached window, which has no pane. */
export interface PaneViewHost {
  paneId?: string;
  /** The view's pane is the active pane of the active workspace. */
  isActive?: boolean;
  /** Whether the surface is shown, for views that stay mounted while hidden. */
  isVisible?: boolean;
}

export interface PaneViewDefinition<T extends PaneContentType, P extends object> {
  component: ComponentType<P>;
  getProps: (buffer: PaneViewBuffer<T>, host: PaneViewHost) => NoInfer<P>;
  /** Remount the view when it shows another buffer instead of updating it in place. */
  keyByBuffer?: boolean;
  /** Loads the view's code once the workbench is idle, for the surfaces opened most. */
  prefetch?: () => Promise<unknown>;
  /** Releases what the buffer holds outside the stores (a native webview) once it closes. */
  onClose?: (buffer: PaneViewBuffer<T>) => void;
  /** Reloads the buffer's content in place, for the tab's Reload action. */
  reload?: (buffer: PaneViewBuffer<T>) => void;
  /** Replaces the view on its card in the horizontal tab carousel. */
  carouselCard?: ComponentType<{ buffer: PaneViewBuffer<T> }>;
  /**
   * Marks a buffer that shows a single external resource. It renders the same in a detached
   * resource window, whose title bar shows this icon and badge.
   */
  resource?: {
    icon: ComponentType<{ buffer: PaneViewBuffer<T> }>;
    badge?: ComponentType<{ buffer: PaneViewBuffer<T> }>;
  };
}

type AnyPaneViewDefinition = PaneViewDefinition<PaneContentType, object>;

const paneViews = new Map<PaneContentType, AnyPaneViewDefinition>();

export function registerPaneView<T extends PaneContentType, P extends object>(
  type: T,
  definition: PaneViewDefinition<T, P>,
) {
  paneViews.set(type, definition as unknown as AnyPaneViewDefinition);
}

export function getPaneView<T extends PaneContentType>(
  type: T,
): PaneViewDefinition<T, object> | undefined {
  return paneViews.get(type) as PaneViewDefinition<T, object> | undefined;
}

/** The registered view for the buffer, or null when its type has none. */
export function renderPaneView(buffer: PaneContent, host: PaneViewHost): ReactElement | null {
  const definition = paneViews.get(buffer.type);
  if (!definition) return null;
  const props = definition.getProps(buffer as PaneViewBuffer<PaneContentType>, host);
  return createElement(
    definition.component,
    definition.keyByBuffer ? { ...props, key: buffer.id } : props,
  );
}

/** Runs the close hook of the buffer's view, if it has one. */
export function releaseClosedPaneView(buffer: PaneContent) {
  paneViews.get(buffer.type)?.onClose?.(buffer);
}

/** Reloads the buffer through its view; false when the view has no reload of its own. */
export function reloadPaneView(buffer: PaneContent): boolean {
  const reload = paneViews.get(buffer.type)?.reload;
  if (!reload) return false;
  reload(buffer);
  return true;
}

export function isResourceBuffer(buffer: PaneContent): boolean {
  return Boolean(paneViews.get(buffer.type)?.resource);
}

/** Starts loading the code of the views registered with `prefetch`. */
export function prefetchPaneViews() {
  for (const definition of paneViews.values()) {
    void definition.prefetch?.();
  }
}
