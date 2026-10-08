import { EyeIcon, PenIcon, SparkleIcon } from "@/ui/icons";
import { toggleMarkdownPreview } from "@/features/editor/markdown/toggle-markdown-preview";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { isMarkdownFile } from "@/features/editor/utils/lines";
import type { Command } from "../types/keymaps.types";
import {
  copyActiveEditorLineDown,
  copyActiveEditorLineUp,
  copyActiveEditorSelection,
  cutActiveEditorSelection,
  deleteActiveEditorLine,
  duplicateActiveEditorLine,
  foldAllActiveEditor,
  foldLevelActiveEditor,
  formatActiveEditorDocument,
  formatActiveEditorSelection,
  insertActiveEditorCursorAbove,
  insertActiveEditorCursorBelow,
  insertActiveEditorCursorsAtLineEnds,
  moveActiveEditorLineDown,
  moveActiveEditorLineUp,
  pasteIntoActiveEditor,
  redoActiveEditor,
  removeActiveEditorSecondaryCursors,
  runQuickFixForActiveEditor,
  selectAllActiveEditor,
  selectAllEditorOccurrences,
  selectNextEditorOccurrence,
  selectPreviousEditorOccurrence,
  showHoverForActiveEditor,
  showInlineEditToolbar,
  toggleActiveEditorComment,
  triggerActiveEditorParameterHints,
  triggerActiveEditorSuggest,
  unfoldAllActiveEditor,
  undoActiveEditor,
} from "./editor-command-actions";

const addSelectionToAgentChat = () => import("@/features/ai/lib/add-selection-to-agent-chat");

const foldLevelCommands: Command[] = Array.from({ length: 7 }, (_, index) => {
  const level = index + 1;

  return {
    id: `editor.foldLevel${level}`,
    title: `Fold Level ${level}`,
    category: "Edit",
    execute: () => foldLevelActiveEditor(level),
  };
});

export const editCommands: Command[] = [
  {
    id: "editor.selectAll",
    title: "Select All",
    category: "Edit",
    execute: selectAllActiveEditor,
  },
  {
    id: "editor.undo",
    title: "Undo",
    category: "Edit",
    execute: undoActiveEditor,
  },
  {
    id: "editor.redo",
    title: "Redo",
    category: "Edit",
    execute: redoActiveEditor,
  },
  {
    id: "editor.copy",
    title: "Copy",
    category: "Edit",
    execute: copyActiveEditorSelection,
  },
  {
    id: "editor.cut",
    title: "Cut",
    category: "Edit",
    execute: cutActiveEditorSelection,
  },
  {
    id: "editor.paste",
    title: "Paste",
    category: "Edit",
    execute: pasteIntoActiveEditor,
  },
  {
    id: "editor.selectNextOccurrence",
    title: "Add Selection To Next Find Match",
    category: "Edit",
    execute: selectNextEditorOccurrence,
  },
  {
    id: "editor.selectPreviousOccurrence",
    title: "Add Selection To Previous Find Match",
    category: "Edit",
    execute: selectPreviousEditorOccurrence,
  },
  {
    id: "editor.selectAllOccurrences",
    title: "Select All Occurrences of Find Match",
    category: "Edit",
    execute: selectAllEditorOccurrences,
  },
  {
    id: "editor.duplicateLine",
    title: "Duplicate Line",
    category: "Edit",
    execute: duplicateActiveEditorLine,
  },
  {
    id: "editor.deleteLine",
    title: "Delete Line",
    category: "Edit",
    execute: deleteActiveEditorLine,
  },
  {
    id: "editor.toggleComment",
    title: "Toggle Comment",
    category: "Edit",
    execute: toggleActiveEditorComment,
  },
  {
    id: "editor.foldAll",
    title: "Fold All",
    category: "Edit",
    execute: () => foldAllActiveEditor(),
  },
  ...foldLevelCommands,
  {
    id: "editor.unfoldAll",
    title: "Unfold All",
    category: "Edit",
    execute: () => unfoldAllActiveEditor(),
  },
  {
    id: "editor.moveLineUp",
    title: "Move Line Up",
    category: "Edit",
    execute: moveActiveEditorLineUp,
  },
  {
    id: "editor.moveLineDown",
    title: "Move Line Down",
    category: "Edit",
    execute: moveActiveEditorLineDown,
  },
  {
    id: "editor.copyLineUp",
    title: "Copy Line Up",
    category: "Edit",
    execute: copyActiveEditorLineUp,
  },
  {
    id: "editor.copyLineDown",
    title: "Copy Line Down",
    category: "Edit",
    execute: copyActiveEditorLineDown,
  },
  {
    id: "editor.insertCursorAbove",
    title: "Add Cursor Above",
    category: "Edit",
    execute: insertActiveEditorCursorAbove,
  },
  {
    id: "editor.insertCursorBelow",
    title: "Add Cursor Below",
    category: "Edit",
    execute: insertActiveEditorCursorBelow,
  },
  {
    id: "editor.insertCursorsAtLineEnds",
    title: "Add Cursors to Line Ends",
    category: "Edit",
    execute: insertActiveEditorCursorsAtLineEnds,
  },
  {
    id: "editor.removeSecondaryCursors",
    title: "Remove Secondary Cursors",
    category: "Edit",
    execute: removeActiveEditorSecondaryCursors,
  },
  {
    id: "editor.formatDocument",
    title: "Format Document",
    category: "Edit",
    execute: () => {
      void formatActiveEditorDocument();
    },
  },
  {
    id: "editor.formatSelection",
    title: "Format Selection",
    category: "Edit",
    execute: () => {
      void formatActiveEditorSelection();
    },
  },
  {
    id: "editor.triggerSuggest",
    title: "Trigger Suggest",
    category: "Edit",
    execute: triggerActiveEditorSuggest,
  },
  {
    id: "editor.triggerParameterHints",
    title: "Trigger Parameter Hints",
    category: "Edit",
    execute: triggerActiveEditorParameterHints,
  },
  {
    id: "editor.showHover",
    title: "Show Hover",
    category: "Edit",
    execute: () => {
      void showHoverForActiveEditor();
    },
  },
  {
    id: "editor.quickFix",
    title: "Quick Fix",
    category: "Edit",
    execute: () => {
      void runQuickFixForActiveEditor();
    },
  },
  {
    id: "editor.inlineEdit",
    title: "Agent Inline Edit",
    category: "Edit",
    execute: showInlineEditToolbar,
  },
  {
    id: "editor.addSelectionToChat",
    title: "Add Selection to Agent Chat",
    category: "Agent",
    description: "Attach the selected code to the current agent chat",
    icon: <SparkleIcon />,
    palette: { label: "AI: Add Selection to Agent Chat", category: "AI" },
    execute: async () => {
      (await addSelectionToAgentChat()).addActiveSelectionToAgentChat();
    },
  },
  {
    id: "editor.addSelectionToNewChat",
    title: "Add Selection to New Agent Chat",
    category: "Agent",
    description: "Start a new agent chat with the selected code attached",
    icon: <SparkleIcon />,
    palette: { label: "AI: Add Selection to New Agent Chat", category: "AI" },
    execute: async () => {
      (await addSelectionToAgentChat()).addActiveSelectionToNewAgentChat();
    },
  },
];

export const markdownCommands: Command[] = [
  {
    id: "markdown.togglePreview",
    title: "Markdown: Toggle Preview",
    category: "Markdown",
    description: "Toggle Markdown preview in the current tab",
    when: ({ activeBuffer }) =>
      activeBuffer?.type === "editor" && isMarkdownFile(activeBuffer.path),
    palette: ({ activeBuffer }) =>
      activeBuffer?.isMarkdownPreview
        ? { label: "Markdown: Show Source", icon: <PenIcon /> }
        : { label: "Markdown: Preview Markdown", icon: <EyeIcon /> },
    execute: () => {
      const { activeBufferId } = useBufferStore.getState();
      if (activeBufferId) toggleMarkdownPreview(activeBufferId);
    },
  },
];
