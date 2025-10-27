import { useCallback, useEffect, useState } from "react";
import type {
  ConversionOptions,
  FlipDirection,
  ImageFormat,
  ResizeOptions,
  RotationDegrees,
} from "../models/image-operation.types";
import { blobToDataURL } from "../utils/canvas-utils";
import { convertImageFormat } from "../utils/image-conversion";
import {
  flipImage,
  resizeImage,
  rotate90CCW,
  rotate90CW,
  rotate180,
  rotateImage,
} from "../utils/image-transforms";

export interface UseImageOperationsOptions {
  initialSrc: string;
  onImageUpdate?: (newSrc: string) => void;
}

export function useImageOperations(options: UseImageOperationsOptions) {
  const { initialSrc, onImageUpdate } = options;

  const [imageSrc, setImageSrc] = useState(initialSrc);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // History for undo/redo
  const [history, setHistory] = useState<string[]>([initialSrc]);
  const [historyIndex, setHistoryIndex] = useState(0);

  // Reset when initialSrc changes (e.g., different image loaded)
  useEffect(() => {
    if (initialSrc) {
      setImageSrc(initialSrc);
      setHistory([initialSrc]);
      setHistoryIndex(0);
      setError(null);
    }
  }, [initialSrc]);

  const updateImage = useCallback(
    async (blob: Blob) => {
      try {
        const dataURL = await blobToDataURL(blob);
        setImageSrc(dataURL);
        onImageUpdate?.(dataURL);

        // Add to history (remove any forward history if we're not at the end)
        const newHistory = history.slice(0, historyIndex + 1);
        newHistory.push(dataURL);
        setHistory(newHistory);
        setHistoryIndex(newHistory.length - 1);

        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to update image");
      }
    },
    [history, historyIndex, onImageUpdate],
  );

  const convertFormat = useCallback(
    async (format: ImageFormat, quality?: number) => {
      setIsProcessing(true);
      setError(null);

      try {
        const options: ConversionOptions = { format, quality };
        const result = await convertImageFormat(imageSrc, options);
        await updateImage(result.blob);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to convert format");
      } finally {
        setIsProcessing(false);
      }
    },
    [imageSrc, updateImage],
  );

  const rotate = useCallback(
    async (degrees: RotationDegrees) => {
      setIsProcessing(true);
      setError(null);

      try {
        const result = await rotateImage(imageSrc, degrees);
        await updateImage(result.blob);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to rotate image");
      } finally {
        setIsProcessing(false);
      }
    },
    [imageSrc, updateImage],
  );

  const rotateCW = useCallback(async () => {
    setIsProcessing(true);
    setError(null);

    try {
      const result = await rotate90CW(imageSrc);
      await updateImage(result.blob);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rotate image");
    } finally {
      setIsProcessing(false);
    }
  }, [imageSrc, updateImage]);

  const rotateCCW = useCallback(async () => {
    setIsProcessing(true);
    setError(null);

    try {
      const result = await rotate90CCW(imageSrc);
      await updateImage(result.blob);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rotate image");
    } finally {
      setIsProcessing(false);
    }
  }, [imageSrc, updateImage]);

  const rotate180Degrees = useCallback(async () => {
    setIsProcessing(true);
    setError(null);

    try {
      const result = await rotate180(imageSrc);
      await updateImage(result.blob);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rotate image");
    } finally {
      setIsProcessing(false);
    }
  }, [imageSrc, updateImage]);

  const flip = useCallback(
    async (direction: FlipDirection) => {
      setIsProcessing(true);
      setError(null);

      try {
        const result = await flipImage(imageSrc, direction);
        await updateImage(result.blob);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to flip image");
      } finally {
        setIsProcessing(false);
      }
    },
    [imageSrc, updateImage],
  );

  const resize = useCallback(
    async (options: ResizeOptions) => {
      setIsProcessing(true);
      setError(null);

      try {
        const result = await resizeImage(imageSrc, options);
        await updateImage(result.blob);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to resize image");
      } finally {
        setIsProcessing(false);
      }
    },
    [imageSrc, updateImage],
  );

  const undo = useCallback(() => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      setImageSrc(history[newIndex]);
      onImageUpdate?.(history[newIndex]);
    }
  }, [history, historyIndex, onImageUpdate]);

  const redo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      setImageSrc(history[newIndex]);
      onImageUpdate?.(history[newIndex]);
    }
  }, [history, historyIndex, onImageUpdate]);

  const reset = useCallback(() => {
    setImageSrc(initialSrc);
    setHistory([initialSrc]);
    setHistoryIndex(0);
    setError(null);
    onImageUpdate?.(initialSrc);
  }, [initialSrc, onImageUpdate]);

  return {
    imageSrc,
    isProcessing,
    error,
    // Format conversion
    convertFormat,
    // Rotation
    rotate,
    rotateCW,
    rotateCCW,
    rotate180: rotate180Degrees,
    // Flip
    flip,
    // Resize
    resize,
    // History
    undo,
    redo,
    reset,
    canUndo: historyIndex > 0,
    canRedo: historyIndex < history.length - 1,
    hasChanges: historyIndex > 0,
  };
}
