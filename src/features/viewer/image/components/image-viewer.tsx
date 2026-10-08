import { ArrowDownIcon, ArrowUpIcon, XIcon } from "@/ui/icons";
import { useEffect, useMemo, useRef, useState } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useActiveWorkspaceId } from "@/features/workspace/stores/create-workspace-scoped-store";
import {
  getImageBufferSession,
  saveImageBufferById,
} from "../editor/services/image-buffer-session";
import { FilePathBreadcrumb } from "@/features/editor/components/toolbar/file-path-breadcrumb";
import {
  PaneContentHeader,
  PaneContentStatusBar,
} from "@/features/panes/components/pane-content-chrome";
import { useResizeObserver } from "@/features/panes/hooks/use-resize-observer";
import { ViewerLayout } from "@/features/viewer/components/viewer-layout";
import { ViewerErrorState, ViewerLoadingState } from "@/features/viewer/components/viewer-state";
import { ImageEditorToolbar } from "@/features/viewer/image/editor/components/image-editor-toolbar";
import { ImageResizeDialog } from "@/features/viewer/image/editor/components/image-resize-dialog";
import { useImageOperations } from "@/features/viewer/image/editor/hooks/use-image-operations";
import {
  blobToDataURL,
  getImageDimensions,
} from "@/features/viewer/image/editor/utils/canvas-utils";
import {
  getDataURLSize,
  saveImageToFile,
} from "@/features/viewer/image/editor/utils/image-file-utils";
import { ViewerZoomControls } from "@/features/viewer/components/viewer-zoom-controls";
import { useViewerZoom } from "@/features/viewer/hooks/use-viewer-zoom";
import { Button } from "@/ui/button";
import { Alert, AlertDescription } from "@/ui/alert";
import { ChromeSeparator } from "@/ui/chrome";
import UnsavedChangesDialog from "@/features/window/components/unsaved-changes-dialog";
import { cn } from "@/utils/cn";
import { formatFileSize } from "@/utils/format-file-size";
import { getImageMimeType } from "@/utils/image-file-types";
import { readFileBytes } from "@/utils/local-files";
import { ImageContextMenu } from "./image-context-menu";
import { resolveAssetUrl } from "@/utils/asset-access";

interface ImageViewerProps {
  filePath: string;
  fileName: string;
  bufferId: string;
  onClose?: () => void;
}

export function ImageViewer({ filePath, fileName, bufferId, onClose }: ImageViewerProps) {
  const workspaceId = useActiveWorkspaceId();
  const ownerStore = useBufferStore.getStore(workspaceId);
  const owner = useMemo(() => ({ workspaceId, store: ownerStore }), [workspaceId, ownerStore]);
  const session = useMemo(
    () => getImageBufferSession(owner, bufferId),
    [owner, bufferId, filePath],
  );
  const { zoom, zoomIn, zoomOut, setZoom, handleWheel } = useViewerZoom({ maxZoom: 5 });
  const viewerKey = useMemo(() => ({}), [filePath, bufferId, owner]);
  const [loadedSource, setLoadedSource] = useState<{ key: object; source: string } | null>(null);
  const initialImageSrc = loadedSource?.key === viewerKey ? loadedSource.source : "";
  const [showResizeDialog, setShowResizeDialog] = useState(false);
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [closeDecision, setCloseDecision] = useState<object | null>(null);
  const closeDecisionRef = useRef(closeDecision);
  closeDecisionRef.current = closeDecision;
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const currentViewer = useRef(viewerKey);
  currentViewer.current = viewerKey;
  const mounted = useRef(true);
  const pendingSave = useRef<{ key: object; promise: Promise<boolean> } | null>(null);
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 });
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });
  const [originalSize, setOriginalSize] = useState(0);
  const [currentSize, setCurrentSize] = useState(0);

  const imageContainerRef = useRef<HTMLDivElement>(null);
  const { width: containerWidth, height: containerHeight } = useResizeObserver(imageContainerRef);
  const [isFitted, setIsFitted] = useState(true);

  const fileExt = fileName.split(".").pop()?.toUpperCase() || "";

  useEffect(() => {
    let cancelled = false;
    mounted.current = true;
    setLoadedSource(null);
    setLoadError(null);
    setSaveError(null);
    setIsSaving(false);
    setCloseDecision(null);
    setImageDimensions({ width: 0, height: 0 });
    setOriginalSize(0);
    setCurrentSize(0);
    const loadImageSrc = async () => {
      let fileSize = 0;

      const applyImageSource = async (src: string) => {
        await getImageDimensions(src);
        if (cancelled) return;
        setLoadedSource({ key: viewerKey, source: src });
        setOriginalSize(fileSize || getDataURLSize(src));
      };

      try {
        const contents = await readFileBytes(filePath);
        fileSize = contents.byteLength;
        const mimeType = getImageMimeType(filePath);

        if (!mimeType) throw new Error(`Unsupported image type: ${filePath}`);

        const dataURL = await blobToDataURL(new Blob([contents], { type: mimeType }));
        await applyImageSource(dataURL);
      } catch (error) {
        console.error("Failed to load image:", error);
        try {
          await applyImageSource(await resolveAssetUrl(filePath));
        } catch (fallbackError) {
          if (cancelled) return;
          setLoadError(
            fallbackError instanceof Error ? fallbackError.message : "Failed to load image",
          );
        }
      }
    };

    void loadImageSrc();
    return () => {
      cancelled = true;
      mounted.current = false;
    };
  }, [viewerKey, loadAttempt]);

  const imageOperations = useImageOperations({
    initialSrc: initialImageSrc,
    sourceKey: viewerKey,
    session: session ?? undefined,
  });
  const displayImageSrc = imageOperations.imageSrc;

  useEffect(() => {
    let cancelled = false;
    if (!displayImageSrc) return;
    setCurrentSize(getDataURLSize(displayImageSrc));
    void getImageDimensions(displayImageSrc)
      .then((dimensions) => {
        if (!cancelled) setImageDimensions(dimensions);
      })
      .catch((error) => {
        if (!cancelled)
          setLoadError(error instanceof Error ? error.message : "Failed to read image dimensions");
      });
    return () => {
      cancelled = true;
    };
  }, [displayImageSrc, viewerKey]);

  // Calculate fit zoom
  useEffect(() => {
    if (
      !isFitted ||
      !containerWidth ||
      !containerHeight ||
      !imageDimensions.width ||
      !imageDimensions.height
    ) {
      return;
    }

    const widthRatio = (containerWidth - 32) / imageDimensions.width;
    const heightRatio = (containerHeight - 32) / imageDimensions.height;
    const fitZoom = Math.min(widthRatio, heightRatio, 1);

    setZoom(fitZoom);
  }, [containerWidth, containerHeight, imageDimensions, isFitted, setZoom]);

  // Wrap manual zoom handlers to disable auto-fit
  const handleManualZoomIn = () => {
    setIsFitted(false);
    zoomIn();
  };

  const handleManualZoomOut = () => {
    setIsFitted(false);
    zoomOut();
  };

  const handleManualReset = () => {
    setIsFitted(true);
    // The effect will trigger and set the zoom
  };

  const handleManualWheel = (e: WheelEvent) => {
    setIsFitted(false);
    handleWheel(e);
  };

  // Attach wheel event listener using our wrapper
  useEffect(() => {
    const container = imageContainerRef.current;
    if (!container) return;

    container.addEventListener("wheel", handleManualWheel, { passive: false });

    return () => {
      container.removeEventListener("wheel", handleManualWheel);
    };
  }, [handleWheel]);

  // Handlers
  const handleResize = async (width: number, height: number, maintainAspectRatio: boolean) => {
    await imageOperations.resize({ width, height, maintainAspectRatio });
  };

  const handleSave = (): Promise<boolean> => {
    if (pendingSave.current?.key === viewerKey) return pendingSave.current.promise;
    const snapshot = imageOperations.captureSave();
    if (!snapshot) return Promise.resolve(false);
    const isCurrent = () =>
      mounted.current &&
      currentViewer.current === viewerKey &&
      imageOperations.isSaveCurrent(snapshot);
    setIsSaving(true);
    setSaveError(null);
    const saveTask = session
      ? saveImageBufferById(owner, bufferId)
      : saveImageToFile(snapshot.source, fileName, { isCurrent, onError: setSaveError });
    const promise = saveTask
      .then((success) =>
        session ? success : success && isCurrent() && imageOperations.markSaved(snapshot),
      )
      .finally(() => {
        if (pendingSave.current?.promise === promise) pendingSave.current = null;
        if (mounted.current && currentViewer.current === viewerKey) setIsSaving(false);
      });
    pendingSave.current = { key: viewerKey, promise };
    return promise;
  };

  const handleClose = () => {
    if (imageOperations.hasChanges || imageOperations.isProcessing) {
      const decision = {};
      closeDecisionRef.current = decision;
      setCloseDecision(decision);
    } else {
      onClose?.();
    }
  };

  const handleSaveAndClose = async () => {
    const decision = closeDecision;
    if (!decision) return;
    const success = await handleSave();
    if (
      !success ||
      !mounted.current ||
      currentViewer.current !== viewerKey ||
      closeDecisionRef.current !== decision
    )
      return;
    closeDecisionRef.current = null;
    setCloseDecision(null);
    onClose?.();
  };

  const handleDiscardAndClose = () => {
    if (
      !closeDecision ||
      closeDecisionRef.current !== closeDecision ||
      currentViewer.current !== viewerKey
    )
      return;
    closeDecisionRef.current = null;
    setCloseDecision(null);
    onClose?.();
  };

  const handleCancelClose = () => {
    closeDecisionRef.current = null;
    setCloseDecision(null);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenuPos({ x: e.clientX, y: e.clientY });
    setShowContextMenu(true);
  };

  return (
    <ViewerLayout className="select-none">
      <PaneContentHeader
        className="absolute inset-x-0 top-0 z-10"
        context={<FilePathBreadcrumb filePath={filePath} />}
        detail={fileExt || undefined}
        actions={
          <>
            {initialImageSrc && (
              <>
                <ImageEditorToolbar
                  onConvertFormat={imageOperations.convertFormat}
                  onRotateCW={imageOperations.rotateCW}
                  onRotateCCW={imageOperations.rotateCCW}
                  onRotate180={imageOperations.rotate180}
                  onFlipHorizontal={() => imageOperations.flip("horizontal")}
                  onFlipVertical={() => imageOperations.flip("vertical")}
                  onResize={() => setShowResizeDialog(true)}
                  onUndo={imageOperations.undo}
                  onRedo={imageOperations.redo}
                  onSave={handleSave}
                  canUndo={imageOperations.canUndo}
                  canRedo={imageOperations.canRedo}
                  hasChanges={imageOperations.hasChanges}
                  isProcessing={imageOperations.isProcessing || isSaving}
                  currentImageSrc={displayImageSrc}
                  currentFileName={fileName}
                />
                <ChromeSeparator />
              </>
            )}
            <ViewerZoomControls
              zoom={zoom}
              onZoomIn={handleManualZoomIn}
              onZoomOut={handleManualZoomOut}
              onResetZoom={handleManualReset}
            />
            {onClose && (
              <Button onClick={handleClose} variant="ghost" tooltip="Close image viewer" iconOnly>
                <XIcon />
              </Button>
            )}
          </>
        }
      />

      {/* Image Content */}
      <div
        ref={imageContainerRef}
        className={cn(
          "absolute inset-x-0 top-7 bottom-7",
          "flex items-center justify-center",
          "overflow-auto bg-background p-4",
        )}
        onContextMenu={handleContextMenu}
      >
        {loadError && !displayImageSrc ? (
          <ViewerErrorState
            message={loadError}
            actionLabel="Retry"
            onAction={() => setLoadAttempt((attempt) => attempt + 1)}
          />
        ) : displayImageSrc ? (
          <img
            src={displayImageSrc}
            alt={fileName}
            style={{
              width: imageDimensions.width ? imageDimensions.width * zoom : "auto",
              height: imageDimensions.height ? imageDimensions.height * zoom : "auto",
              maxWidth: "none",
              maxHeight: "none",
            }}
            draggable={false}
          />
        ) : (
          <ViewerLoadingState label="Loading image" className="p-8" />
        )}
      </div>

      <div className="absolute inset-x-0 bottom-0 z-10">
        <PaneContentStatusBar endContent={<span>Size: {formatFileSize(currentSize)}</span>}>
          <span>Zoom: {Math.round(zoom * 100)}%</span>
          {fileExt ? <span>Type: {fileExt}</span> : null}
          <span>
            {imageDimensions.width} × {imageDimensions.height}px
          </span>
          {imageOperations.hasChanges && originalSize > 0 && originalSize !== currentSize ? (
            <span className="flex items-center gap-0.5 text-primary">
              {currentSize < originalSize ? (
                <ArrowDownIcon className="inline" />
              ) : (
                <ArrowUpIcon className="inline" />
              )}
              {Math.abs(Math.round(((currentSize - originalSize) / originalSize) * 100))}%
            </span>
          ) : null}
        </PaneContentStatusBar>
      </div>

      {saveError || imageOperations.error ? (
        <Alert tone="error" variant="banner" className="absolute inset-x-0 bottom-7">
          <AlertDescription>{saveError || imageOperations.error}</AlertDescription>
        </Alert>
      ) : null}

      {/* Resize Dialog */}
      <ImageResizeDialog
        isOpen={showResizeDialog}
        onClose={() => setShowResizeDialog(false)}
        onResize={handleResize}
        currentWidth={imageDimensions.width}
        currentHeight={imageDimensions.height}
      />

      {/* Context Menu */}
      {showContextMenu && (
        <ImageContextMenu
          x={contextMenuPos.x}
          y={contextMenuPos.y}
          filePath={filePath}
          onClose={() => setShowContextMenu(false)}
          onConvertFormat={imageOperations.convertFormat}
          onRotateCW={imageOperations.rotateCW}
          onRotateCCW={imageOperations.rotateCCW}
          onRotate180={imageOperations.rotate180}
          onFlipHorizontal={() => imageOperations.flip("horizontal")}
          onFlipVertical={() => imageOperations.flip("vertical")}
          onResize={() => {
            setShowResizeDialog(true);
            setShowContextMenu(false);
          }}
          onUndo={imageOperations.undo}
          onRedo={imageOperations.redo}
          onSave={handleSave}
          canUndo={imageOperations.canUndo}
          canRedo={imageOperations.canRedo}
          hasChanges={imageOperations.hasChanges}
          isProcessing={imageOperations.isProcessing || isSaving}
          currentImageSrc={displayImageSrc}
          currentFileName={fileName}
        />
      )}

      {/* Unsaved Changes Dialog */}
      {closeDecision && (
        <UnsavedChangesDialog
          decisionKey={closeDecision}
          fileName={fileName}
          onSave={handleSaveAndClose}
          onDiscard={handleDiscardAndClose}
          onCancel={handleCancelClose}
        />
      )}
    </ViewerLayout>
  );
}
