import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type {
  FlipDirection,
  ImageFormat,
  ResizeOptions,
  RotationDegrees,
} from "../types/image-operation.types";
import { ImageEditSession } from "../services/image-edit-session";
import { convertImageFormat } from "../utils/image-conversion";
import { flipImage, resizeImage, rotateImage } from "../utils/image-transforms";
interface UseImageOperationsOptions {
  initialSrc: string;
  sourceKey?: unknown;
  session?: ImageEditSession;
  onImageUpdate?: (newSrc: string) => void;
}
export function useImageOperations({
  initialSrc,
  sourceKey,
  session: ownedSession,
  onImageUpdate,
}: UseImageOperationsOptions) {
  const session = useMemo(() => ownedSession ?? new ImageEditSession(), [ownedSession, sourceKey]);
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const onUpdate = useRef(onImageUpdate);
  onUpdate.current = onImageUpdate;
  useEffect(() => {
    session.setSource(initialSrc, !!ownedSession);
    if (!ownedSession) return () => session.dispose();
  }, [session, initialSrc, ownedSession]);
  useEffect(() => {
    if (!onUpdate.current) return;
    let previous = session.getSnapshot().history[session.getSnapshot().index];
    return session.subscribe(() => {
      const current = session.getSnapshot();
      const source = current.history[current.index];
      if (source !== previous) {
        previous = source;
        onUpdate.current?.(source);
      }
    });
  }, [session]);
  const convertFormat = useCallback(
    (format: ImageFormat, quality?: number) =>
      session.runOperation(
        (source) => convertImageFormat(source, { format, quality }),
        "Failed to convert format",
      ),
    [session],
  );
  const rotate = useCallback(
    (degrees: RotationDegrees) =>
      session.runOperation((source) => rotateImage(source, degrees), "Failed to rotate image"),
    [session],
  );
  const rotateCW = useCallback(() => rotate(90), [rotate]);
  const rotateCCW = useCallback(() => rotate(270), [rotate]);
  const rotate180 = useCallback(() => rotate(180), [rotate]);
  const flip = useCallback(
    (direction: FlipDirection) =>
      session.runOperation((source) => flipImage(source, direction), "Failed to flip image"),
    [session],
  );
  const resize = useCallback(
    (options: ResizeOptions) =>
      session.runOperation((source) => resizeImage(source, options), "Failed to resize image"),
    [session],
  );
  return {
    imageSrc: state.history[state.index],
    isProcessing: state.processing > 0,
    error: state.error,
    convertFormat,
    rotate,
    rotateCW,
    rotateCCW,
    rotate180,
    flip,
    resize,
    undo: session.undo,
    redo: session.redo,
    reset: session.reset,
    captureSave: session.captureSave,
    isSaveCurrent: session.isSaveCurrent,
    markSaved: session.markSaved,
    canUndo: state.index > 0,
    canRedo: state.index < state.history.length - 1,
    hasChanges: state.history[state.index] !== state.savedSrc,
  };
}
