import { registerEditorFeatures } from "@/features/editor/services/editor-feature-registry";

const loadAiEditorContribution = () =>
  import("../editor/ai-editor-contribution").then((module) => module.aiEditorContribution);

/** Registers the AI editor features; every window that shows code editors runs this. */
export function registerAiEditorFeatures() {
  registerEditorFeatures(loadAiEditorContribution);
}
