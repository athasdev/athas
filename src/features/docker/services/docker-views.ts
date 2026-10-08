import { lazy } from "react";
import { registerSidebarView } from "@/features/layout/services/sidebar-view-registry";

const DockerSidebar = lazy(() =>
  import("../components/docker-sidebar").then((module) => ({ default: module.DockerSidebar })),
);

export function registerDockerViews() {
  registerSidebarView({
    id: "docker",
    order: 40,
    component: DockerSidebar,
    isAvailable: ({ coreFeatures }) => coreFeatures.docker,
    loadsOnDemand: true,
    suspendWhenHidden: true,
  });
}
