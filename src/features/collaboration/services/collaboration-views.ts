import { lazy } from "react";
import { registerSidebarView } from "@/features/layout/services/sidebar-view-registry";

const CollaborationSidebarView = lazy(() =>
  import("../components/collaboration-sidebar").then((module) => ({
    default: module.CollaborationSidebarView,
  })),
);

export function registerCollaborationViews() {
  registerSidebarView({
    id: "collaboration",
    order: 100,
    component: CollaborationSidebarView,
    isAvailable: ({ coreFeatures, hasTeamsCollaborationAccess }) =>
      hasTeamsCollaborationAccess && coreFeatures.teamCollaboration,
    loadsOnDemand: true,
  });
}
