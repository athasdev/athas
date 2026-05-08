import { isEditorContent, type PaneContent } from "@/features/panes/types/pane-content";
import { primitiveChoice } from "@/ui/primitive-dialog-service";
import { toast } from "@/ui/toast";

export type ProjectTransitionAction =
  | "switching projects"
  | "closing this project"
  | "restarting to update";

type UnsavedProjectTransitionChoice = "cancel" | "discard" | "save";

export const getDirtyEditorBuffers = (buffers: PaneContent[]) =>
  buffers.filter((buffer) => isEditorContent(buffer) && buffer.isDirty);

export const getUnsavedProjectTransitionMessage = (
  action: ProjectTransitionAction,
  buffers: PaneContent[],
) => {
  const dirtyBuffers = getDirtyEditorBuffers(buffers);

  if (dirtyBuffers.length === 0) {
    return null;
  }

  if (dirtyBuffers.length === 1) {
    return `Save changes to "${dirtyBuffers[0].name}" before ${action}?`;
  }

  return `Save changes to ${dirtyBuffers.length} files before ${action}?`;
};

const saveDirtyEditorBuffers = async (dirtyBuffers: PaneContent[]) => {
  const { useBufferStore } = await import("@/features/editor/stores/buffer-store");
  const { useEditorAppStore } = await import("@/features/editor/stores/editor-app-store");
  const { setActiveBuffer } = useBufferStore.getState().actions;
  const { handleSave } = useEditorAppStore.getState().actions;

  for (const dirtyBuffer of dirtyBuffers) {
    const currentBuffer = useBufferStore
      .getState()
      .buffers.find((buffer) => buffer.id === dirtyBuffer.id);

    if (!currentBuffer || !isEditorContent(currentBuffer) || !currentBuffer.isDirty) {
      continue;
    }

    setActiveBuffer(currentBuffer.id);
    await handleSave();

    const savedBuffer = useBufferStore
      .getState()
      .buffers.find((buffer) => buffer.id === currentBuffer.id);

    if (savedBuffer && isEditorContent(savedBuffer) && savedBuffer.isDirty) {
      toast.warning(`Save "${savedBuffer.name}" before continuing.`);
      return false;
    }
  }

  const remainingDirtyBuffers = getDirtyEditorBuffers(useBufferStore.getState().buffers);
  if (remainingDirtyBuffers.length > 0) {
    toast.warning(`Save or close ${remainingDirtyBuffers.length} unsaved files before continuing.`);
    return false;
  }

  return true;
};

export const prepareProjectTransitionWithUnsavedBuffers = async (
  action: ProjectTransitionAction,
  buffers: PaneContent[],
) => {
  const dirtyBuffers = getDirtyEditorBuffers(buffers);
  if (dirtyBuffers.length === 0) {
    return true;
  }

  const message = getUnsavedProjectTransitionMessage(action, dirtyBuffers);
  if (!message) {
    return true;
  }

  const choice = await primitiveChoice<UnsavedProjectTransitionChoice>(message, {
    title: "Unsaved Changes",
    choices: [
      { value: "cancel", label: "Cancel", variant: "default" },
      {
        value: "discard",
        label: dirtyBuffers.length === 1 ? "Don't Save" : "Discard All",
        variant: "default",
      },
      {
        value: "save",
        label: dirtyBuffers.length === 1 ? "Save" : "Save All",
        variant: "accent",
      },
    ],
  });

  if (choice === "discard") {
    return true;
  }

  if (choice !== "save") {
    return false;
  }

  return await saveDirtyEditorBuffers(dirtyBuffers);
};
