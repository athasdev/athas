import { parseDroppedPaths } from "./file-system-dropped-paths";

export interface ExternalFileDropPayload {
  type: string;
  paths?: string[];
}

export interface ExternalFileDropController {
  onDrop: (paths: string[]) => void | Promise<void>;
  setDraggingOver: (isDraggingOver: boolean) => void;
  onError?: (error: unknown) => void;
}

export async function handleDroppedExternalPaths(
  rawPaths: string[],
  onDrop: (paths: string[]) => void | Promise<void>,
  onError?: (error: unknown) => void,
) {
  const paths = parseDroppedPaths(rawPaths);
  if (paths.length === 0) return;

  try {
    await onDrop(paths);
  } catch (error) {
    onError?.(error);
  }
}

export async function handleExternalFileDropPayload(
  payload: ExternalFileDropPayload,
  controller: ExternalFileDropController,
) {
  if (payload.type === "drop" && "paths" in payload) {
    await handleDroppedExternalPaths(payload.paths || [], controller.onDrop, controller.onError);
    controller.setDraggingOver(false);
    return true;
  }

  if (payload.type === "enter") {
    controller.setDraggingOver(true);
    return true;
  }

  if (payload.type === "leave") {
    controller.setDraggingOver(false);
    return true;
  }

  return false;
}

export function isExternalFileDragTypeList(types: Iterable<string> | null | undefined): boolean {
  if (!types) return false;
  return Array.from(types).includes("Files");
}
