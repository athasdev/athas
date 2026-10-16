import type { ComponentType, ReactNode } from "react";
import type { SidebarView } from "@/features/layout/types/sidebar.types";
import type { CoreFeaturesState } from "@/features/settings/types/feature.types";

/**
 * The project tools (Files, Source Control, GitHub and the rest), contributed by the features
 * that own them. Each opens as a pane of the dock (`view:<id>`). A feature registers its views from
 * its registration module, which the workbench runs once before it renders. Registration modules
 * reference views through `lazy()`, so a view's code loads the first time it shows. Extension views
 * are added by the dock after every registered view.
 */

/** What the dock hands each project tool view. */
export interface SidebarViewContext {
  rootFolderPath: string | undefined;
  onFileSelect: (path: string, isDir: boolean) => void;
  /** The view is on screen in the dock. */
  isActive: boolean;
}

/** What decides whether a view is offered at all. */
export interface SidebarViewAvailability {
  coreFeatures: CoreFeaturesState;
  hasTeamsCollaborationAccess: boolean;
}

export interface SidebarViewDefinition<P extends object> {
  id: SidebarView;
  /** The name the view goes by in the dock header and the menus that open it. */
  title: string;
  icon: ReactNode;
  /** Position among the registered views, lowest first. */
  order: number;
  component: ComponentType<P>;
  getProps?: (context: SidebarViewContext) => NoInfer<P>;
  isAvailable?: (availability: SidebarViewAvailability) => boolean;
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
