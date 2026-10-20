import { PackageIcon } from "@/ui/icons";
import { createElement, lazy } from "react";
import { registerSidebarView } from "@/features/layout/services/sidebar-view-registry";

const loadDockerSidebar = () => import("../components/docker-sidebar");
const DockerSidebar = lazy(() =>
  loadDockerSidebar().then((module) => ({ default: module.DockerSidebar })),
);
const DockerHeaderActions = lazy(() =>
  loadDockerSidebar().then((module) => ({ default: module.DockerHeaderActions })),
);

export function registerDockerViews() {
  registerSidebarView({
    id: "docker",
    title: "Docker",
    icon: createElement(PackageIcon),
    order: 40,
    component: DockerSidebar,
    HeaderActions: DockerHeaderActions,
    isAvailable: ({ coreFeatures }) => coreFeatures.docker,
  });
}
