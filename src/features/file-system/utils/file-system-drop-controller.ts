import { parseDroppedPaths } from "./file-system-dropped-paths";

export const TERMINAL_FILE_DROP_EVENT = "athas-terminal-file-drop";

export interface TerminalFileDropDetail {
  paths: string[];
}

export function resolveDropClientPoint(
  position: { x: number; y: number },
  scaleFactor: number,
  elementFromPoint: (x: number, y: number) => Element | null,
) {
  const effectiveScaleFactor = Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1;
  const logicalPoint = {
    x: position.x / effectiveScaleFactor,
    y: position.y / effectiveScaleFactor,
  };
  const logicalElement = elementFromPoint(logicalPoint.x, logicalPoint.y);

  if (logicalElement || effectiveScaleFactor === 1) {
    return { point: logicalPoint, element: logicalElement };
  }

  const rawPoint = { x: position.x, y: position.y };
  return {
    point: rawPoint,
    element: elementFromPoint(rawPoint.x, rawPoint.y),
  };
}

export interface ExternalFileDropPayload {
  type: string;
  paths?: string[];
  position?: { x: number; y: number };
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

export type ExternalFileDropRoute = "global" | "local" | "terminal";

const TERMINAL_DROP_TARGET_SELECTOR = "[data-terminal-drop-target]";
const LOCAL_DROP_TARGET_SELECTOR = [
  "[data-external-file-drop-scope]",
  "[data-bottom-pane-drop-target]",
  "[data-ai-context-drop-target]",
].join(",");
const PANE_DROP_TARGET_SELECTOR = "[data-pane-container]";

export function dispatchDroppedPathsToTerminal(
  target: Pick<Element, "closest"> | null | undefined,
  rawPaths: string[],
): boolean {
  const terminalTarget = target?.closest<HTMLElement>(TERMINAL_DROP_TARGET_SELECTOR);
  const paths = parseDroppedPaths(rawPaths);
  if (!terminalTarget || paths.length === 0) return false;

  terminalTarget.dispatchEvent(
    new CustomEvent<TerminalFileDropDetail>(TERMINAL_FILE_DROP_EVENT, {
      detail: { paths },
    }),
  );
  return true;
}

export function getExternalFileDropRoute(
  target: Pick<Element, "closest"> | null | undefined,
  treatPaneDropAsGlobal = false,
): ExternalFileDropRoute {
  if (!target) return "global";
  if (target.closest(TERMINAL_DROP_TARGET_SELECTOR)) return "terminal";
  if (target.closest(LOCAL_DROP_TARGET_SELECTOR)) return "local";
  if (target.closest(PANE_DROP_TARGET_SELECTOR)) {
    return treatPaneDropAsGlobal ? "global" : "local";
  }
  return "global";
}
