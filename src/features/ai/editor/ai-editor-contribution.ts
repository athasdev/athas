import type { EditorFeatureContribution } from "@/features/editor/services/editor-feature-registry";
import { IntelligenceCompletionStatus } from "../intelligence/components/intelligence-completion-status";
import { AiInlineCompletion } from "./ai-inline-completion";
import { CodeMirrorAgentEdits } from "./codemirror-agent-edits";
import { CodeMirrorInlineEdit } from "./codemirror-inline-edit";
import { CodeMirrorSelectionAgentAction } from "./codemirror-selection-agent-action";

/**
 * What AI adds to the code editor: agent edit hunks, the selection toolbar (inline edit, add to
 * chat), inline edit, ghost text completions, and the tab autocomplete status.
 */
export const aiEditorContribution: EditorFeatureContribution = {
  codeMirror: {
    overlays: [CodeMirrorAgentEdits, CodeMirrorSelectionAgentAction, CodeMirrorInlineEdit],
    completion: [AiInlineCompletion],
  },
  statusActions: [IntelligenceCompletionStatus],
};
