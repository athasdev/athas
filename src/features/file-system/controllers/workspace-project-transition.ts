import { isEditorContent, type PaneContent } from "@/features/panes/types/pane-content";

export const getDirtyEditorBuffers = (buffers: PaneContent[]) =>
  buffers.filter((buffer) => isEditorContent(buffer) && buffer.isDirty);

export const getBlockedProjectTransitionMessage = (
  action: "switching projects" | "closing this project",
  buffers: PaneContent[],
) => {
  const dirtyBuffers = getDirtyEditorBuffers(buffers);

  if (dirtyBuffers.length === 0) {
    return null;
  }

  if (dirtyBuffers.length === 1) {
    return `Save or close "${dirtyBuffers[0].name}" before ${action}.`;
  }

  return `Save or close ${dirtyBuffers.length} unsaved files before ${action}.`;
};
