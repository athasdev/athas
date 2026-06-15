import {
  ArrowLeftIcon as ArrowLeft,
  ArrowRightIcon as ArrowRight,
  ColumnsIcon as Columns,
  LockIcon as Lock,
  RowsIcon as Rows,
  XIcon as X,
} from "@phosphor-icons/react";
import {
  closeActiveEditorGroup,
  closeOtherEditorGroups,
  moveActiveEditorToAdjacentGroup,
  resetEditorGroupSizes,
  splitActiveEditorGroup,
  toggleActiveEditorGroupLock,
} from "@/features/panes/utils/pane-command-actions";
import type { Action } from "../types/action.types";

interface PaneActionsParams {
  onClose: () => void;
}

export const createPaneActions = ({ onClose }: PaneActionsParams): Action[] => [
  {
    id: "pane-split-editor-right",
    label: "View: Split Editor Right",
    description: "Split the active editor group to the right",
    icon: <Columns />,
    category: "View",
    commandId: "workbench.splitEditorRight",
    action: () => {
      onClose();
      splitActiveEditorGroup("horizontal");
    },
  },
  {
    id: "pane-split-editor-down",
    label: "View: Split Editor Down",
    description: "Split the active editor group downward",
    icon: <Rows />,
    category: "View",
    commandId: "workbench.splitEditorDown",
    action: () => {
      onClose();
      splitActiveEditorGroup("vertical");
    },
  },
  {
    id: "pane-close-editor-group",
    label: "View: Close Editor Group",
    description: "Close the active editor group and move its editors to a nearby group",
    icon: <X />,
    category: "View",
    commandId: "workbench.closeEditorGroup",
    action: () => {
      onClose();
      closeActiveEditorGroup();
    },
  },
  {
    id: "pane-close-other-editor-groups",
    label: "View: Close Other Editor Groups",
    description: "Close every editor group except the active group",
    icon: <X />,
    category: "View",
    commandId: "workbench.closeOtherEditorGroups",
    action: () => {
      onClose();
      closeOtherEditorGroups();
    },
  },
  {
    id: "pane-move-editor-next-group",
    label: "View: Move Editor Into Next Group",
    description: "Move the active editor into the next editor group",
    icon: <ArrowRight />,
    category: "View",
    commandId: "workbench.moveEditorToNextGroup",
    action: () => {
      onClose();
      moveActiveEditorToAdjacentGroup("next");
    },
  },
  {
    id: "pane-move-editor-previous-group",
    label: "View: Move Editor Into Previous Group",
    description: "Move the active editor into the previous editor group",
    icon: <ArrowLeft />,
    category: "View",
    commandId: "workbench.moveEditorToPreviousGroup",
    action: () => {
      onClose();
      moveActiveEditorToAdjacentGroup("previous");
    },
  },
  {
    id: "pane-reset-editor-group-sizes",
    label: "View: Reset Editor Group Sizes",
    description: "Reset editor groups to equal sizes",
    icon: <Columns />,
    category: "View",
    commandId: "workbench.resetEditorGroupSizes",
    action: () => {
      onClose();
      resetEditorGroupSizes();
    },
  },
  {
    id: "pane-toggle-editor-group-lock",
    label: "View: Toggle Editor Group Lock",
    description: "Keep the active editor group from receiving newly opened buffers",
    icon: <Lock />,
    category: "View",
    commandId: "workbench.toggleEditorGroupLock",
    action: () => {
      onClose();
      toggleActiveEditorGroupLock();
    },
  },
];
