import type { ComponentType } from "react";
import type { SidebarView } from "@/features/layout/types/sidebar.types";
import type { CoreFeaturesState } from "@/features/settings/types/feature.types";

/**
 * The views the sidebar panes show, contributed by the features that own them. A feature
 * registers its views from its registration module, which the workbench runs once before it
 * renders (`bootstrap/services/register-workbench-views.ts`). Registration modules reference views
 * through `lazy()`, so a view's code loads the first time it shows. Extension views are added by the
 * sidebar pane itself, after every registered view.
 */

/** What the sidebar pane hands each view. */
export interface SidebarViewContext {
  rootFolderPath: string | undefined;
  onFileSelect: (path: string, isDir: boolean) => void;
  /** The view is the active view of its sidebar pane. */
  isActive: boolean;
}

/** What decides whether a view is offered at all. */
export interface SidebarViewAvailability {
  coreFeatures: CoreFeaturesState;
  hasTeamsCollaborationAccess: boolean;
}

export interface SidebarViewDefinition<P extends object> {
  id: SidebarView;
  /** Position among the registered views, lowest first. */
  order: number;
  component: ComponentType<P>;
  getProps?: (context: SidebarViewContext) => NoInfer<P>;
  isAvailable?: (availability: SidebarViewAvailability) => boolean;
  /** The view's code loads on demand, so it renders inside its own Suspense boundary. */
  loadsOnDemand?: boolean;
  /** Pause the view while its sidebar is collapsed instead of keeping it running. */
  suspendWhenHidden?: boolean;
}

type AnySidebarViewDefinition = SidebarViewDefinition<object>;

const sidebarViews = new Map<SidebarView, AnySidebarViewDefinition>();
let sortedSidebarViews: AnySidebarViewDefinition[] | null = null;

export function registerSidebarView<P extends object>(definition: SidebarViewDefinition<P>) {
  sidebarViews.set(definition.id, definition as unknown as AnySidebarViewDefinition);
  sortedSidebarViews = null;
}

/** Every registered view, in order. */
export function getSidebarViews(): readonly AnySidebarViewDefinition[] {
  sortedSidebarViews ??= [...sidebarViews.values()].sort((a, b) => a.order - b.order);
  return sortedSidebarViews;
}
