import { SidebarSimple, Plus } from "@phosphor-icons/react";
import type { SidebarView } from "@/features/layout/utils/sidebar-pane-utils";
import { SIDEBAR_BUILDER_WIDGET_DEFINITIONS } from "@/features/sidebar-builder/constants/sidebar-builder-widgets";
import {
  SIDEBAR_BUILDER_VIEW_ID,
  useSidebarBuilderStore,
} from "@/features/sidebar-builder/stores/sidebar-builder-store";
import type { Action } from "../models/action.types";

interface SidebarBuilderActionsParams {
  setIsSidebarVisible: (v: boolean) => void;
  setActiveView: (view: SidebarView) => void;
  onClose: () => void;
}

export const createSidebarBuilderActions = ({
  setIsSidebarVisible,
  setActiveView,
  onClose,
}: SidebarBuilderActionsParams): Action[] => [
  {
    id: "show-sidebar-builder",
    label: "Sidebar: Show Custom Sidebar",
    description: "Open the customizable sidebar view",
    icon: <SidebarSimple />,
    category: "Sidebar",
    action: () => {
      setActiveView(SIDEBAR_BUILDER_VIEW_ID);
      setIsSidebarVisible(true);
      onClose();
    },
  },
  ...SIDEBAR_BUILDER_WIDGET_DEFINITIONS.map((definition) => ({
    id: `sidebar-builder-add-${definition.type}`,
    label: `Sidebar: Add ${definition.label}`,
    description: definition.description,
    icon: <Plus />,
    category: "Sidebar",
    action: () => {
      useSidebarBuilderStore.getState().actions.addWidget(definition.type);
      setActiveView(SIDEBAR_BUILDER_VIEW_ID);
      setIsSidebarVisible(true);
      onClose();
    },
  })),
];
