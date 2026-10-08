import {
  isEditorContent,
  type EditorContent,
  type PaneContent,
} from "@/features/panes/types/pane-content.types";

function isDirtyEditorBuffer(buffer: PaneContent): buffer is EditorContent {
  return isEditorContent(buffer) && buffer.isDirty;
}

function isDirtyWritableEditorBuffer(buffer: PaneContent): buffer is EditorContent {
  return isDirtyEditorBuffer(buffer) && !buffer.readOnly;
}

export function findDirtyEditorBuffer(buffers: PaneContent[]) {
  return buffers.find(isDirtyEditorBuffer);
}

export function getDirtyEditorBuffers(buffers: PaneContent[]) {
  return buffers.filter(isDirtyEditorBuffer);
}

export function getDirtyWritableEditorBuffers(buffers: PaneContent[]) {
  return buffers.filter(isDirtyWritableEditorBuffer);
}
