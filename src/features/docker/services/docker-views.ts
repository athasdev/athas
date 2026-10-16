import { PackageIcon } from "@/ui/icons";
import { createElement, lazy } from "react";
import { registerSidebarView } from "@/features/layout/services/sidebar-view-registry";

const DockerSidebar = lazy(() =>
  import("../components/docker-sidebar").then((module) => ({ default: module.DockerSidebar })),
);

export function registerDockerViews() {
  registerSidebarView({
    id: "docker",
    title: "Docker",
    icon: createElement(PackageIcon),
    order: 40,
    component: DockerSidebar,
    isAvailable: ({ coreFeatures }) => coreFeatures.docker,
  });
}
