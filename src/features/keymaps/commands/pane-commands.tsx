import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowsOutIcon,
  ColumnsIcon,
  LockIcon,
  RowsIcon,
  XIcon,
} from "@/ui/icons";
import {
  closeActiveEditorGroup,
  closeOtherEditorGroups,
  moveActiveEditorToAdjacentGroup,
  resetEditorGroupSizes,
  splitActiveEditorGroup,
  toggleActiveEditorGroupLock,
  toggleActivePaneFullscreen,
} from "@/features/panes/utils/pane-command-actions";
import type { Command } from "../types/keymaps.types";

export const paneCommands: Command[] = [
  {
    id: "workbench.toggleActivePaneFullscreen",
    title: "Toggle Active Pane Full Screen",
    category: "View",
    description: "Expand the active pane or return it to the workbench layout",
    icon: <ArrowsOutIcon />,
    palette: { label: "View: Toggle Active Pane Full Screen" },
    execute: () => {
      toggleActivePaneFullscreen();
    },
  },
  {
    id: "workbench.splitEditorRight",
    title: "Split Editor Right",
    category: "View",
    description: "Split the active editor group to the right",
    icon: <ColumnsIcon />,
    palette: { label: "View: Split Editor Right" },
    execute: () => {
      splitActiveEditorGroup("horizontal");
    },
  },
  {
    id: "workbench.splitEditorDown",
    title: "Split Editor Down",
    category: "View",
    description: "Split the active editor group downward",
    icon: <RowsIcon />,
    palette: { label: "View: Split Editor Down" },
    execute: () => {
      splitActiveEditorGroup("vertical");
    },
  },
  {
    id: "workbench.closeEditorGroup",
    title: "Close Editor Group",
    category: "View",
    description: "Close the active editor group and move its editors to a nearby group",
    icon: <XIcon />,
    palette: { label: "View: Close Editor Group" },
    execute: () => {
      closeActiveEditorGroup();
    },
  },
  {
    id: "workbench.closeOtherEditorGroups",
    title: "Close Other Editor Groups",
    category: "View",
    description: "Close every editor group except the active group",
    icon: <XIcon />,
    palette: { label: "View: Close Other Editor Groups" },
    execute: () => {
      closeOtherEditorGroups();
    },
  },
  {
    id: "workbench.moveEditorToNextGroup",
    title: "Move Editor Into Next Group",
    category: "View",
    description: "Move the active editor into the next editor group",
    icon: <ArrowRightIcon />,
    palette: { label: "View: Move Editor Into Next Group" },
    execute: () => {
      moveActiveEditorToAdjacentGroup("next");
    },
  },
  {
    id: "workbench.moveEditorToPreviousGroup",
    title: "Move Editor Into Previous Group",
    category: "View",
    description: "Move the active editor into the previous editor group",
    icon: <ArrowLeftIcon />,
    palette: { label: "View: Move Editor Into Previous Group" },
    execute: () => {
      moveActiveEditorToAdjacentGroup("previous");
    },
  },
  {
    id: "workbench.resetEditorGroupSizes",
    title: "Reset Editor Group Sizes",
    category: "View",
    description: "Reset editor groups to equal sizes",
    icon: <ColumnsIcon />,
    palette: { label: "View: Reset Editor Group Sizes" },
    execute: () => {
      resetEditorGroupSizes();
    },
  },
  {
    id: "workbench.toggleEditorGroupLock",
    title: "Toggle Editor Group Lock",
    category: "View",
    description: "Keep the active editor group from receiving newly opened buffers",
    icon: <LockIcon />,
    palette: { label: "View: Toggle Editor Group Lock" },
    execute: () => {
      toggleActiveEditorGroupLock();
    },
  },
];
