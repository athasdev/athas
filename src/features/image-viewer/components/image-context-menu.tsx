import {
  Copy,
  FileText,
  FlipHorizontal,
  FlipVertical,
  FolderOpen,
  Image,
  RotateCcw,
  RotateCw,
  Save,
  Undo2,
} from "lucide-react";
import { useState } from "react";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import { ImageFormatDialog } from "@/features/image-editor/components/image-format-dialog";
import type { ImageFormat } from "@/features/image-editor/models/image-operation.types";
import { ContextMenu, type ContextMenuItem } from "@/ui/context-menu";

interface ImageContextMenuProps {
  x: number;
  y: number;
  filePath: string;
  onClose: () => void;
  onConvertFormat: (format: ImageFormat, quality?: number) => void;
  onRotateCW: () => void;
  onRotateCCW: () => void;
  onRotate180: () => void;
  onFlipHorizontal: () => void;
  onFlipVertical: () => void;
  onResize: () => void;
  onUndo: () => void;
  onSave: () => void;
  canUndo: boolean;
  hasChanges: boolean;
  isProcessing: boolean;
  currentImageSrc: string;
  currentFileName: string;
}

export function ImageContextMenu({
  x,
  y,
  filePath,
  onClose,
  onConvertFormat,
  onRotateCW,
  onRotateCCW,
  onRotate180,
  onFlipHorizontal,
  onFlipVertical,
  onResize,
  onUndo,
  onSave,
  canUndo,
  hasChanges,
  isProcessing,
  currentImageSrc,
  currentFileName,
}: ImageContextMenuProps) {
  const [formatDialogState, setFormatDialogState] = useState<{
    isOpen: boolean;
    format: ImageFormat | null;
  }>({ isOpen: false, format: null });
  const handleRevealInFolder = useFileSystemStore.use.handleRevealInFolder?.();

  const handleFormatSelect = (format: ImageFormat) => {
    setFormatDialogState({ isOpen: true, format });
  };

  const handleConvert = (format: ImageFormat, quality?: number) => {
    onConvertFormat(format, quality);
    setFormatDialogState({ isOpen: false, format: null });
    onClose();
  };

  const handleDialogClose = () => {
    setFormatDialogState({ isOpen: false, format: null });
    onClose();
  };

  const handleCopyPath = async () => {
    try {
      const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
      await writeText(filePath);
    } catch (error) {
      console.error("Failed to copy path:", error);
    }
  };

  const items: ContextMenuItem[] = [
    {
      id: "rotate-cw",
      label: "Rotate 90deg CW",
      icon: <RotateCw size={13} />,
      disabled: isProcessing,
      onClick: onRotateCW,
    },
    {
      id: "rotate-ccw",
      label: "Rotate 90deg CCW",
      icon: <RotateCcw size={13} />,
      disabled: isProcessing,
      onClick: onRotateCCW,
    },
    {
      id: "rotate-180",
      label: "Rotate 180deg",
      icon: <RotateCw size={13} />,
      disabled: isProcessing,
      onClick: onRotate180,
    },
    { id: "sep-1", label: "", separator: true, onClick: () => {} },
    {
      id: "flip-horizontal",
      label: "Flip Horizontal",
      icon: <FlipHorizontal size={13} />,
      disabled: isProcessing,
      onClick: onFlipHorizontal,
    },
    {
      id: "flip-vertical",
      label: "Flip Vertical",
      icon: <FlipVertical size={13} />,
      disabled: isProcessing,
      onClick: onFlipVertical,
    },
    {
      id: "resize",
      label: "Resize...",
      icon: <Image size={13} />,
      disabled: isProcessing,
      onClick: onResize,
    },
    { id: "sep-2", label: "", separator: true, onClick: () => {} },
    {
      id: "convert-png",
      label: "Convert to PNG...",
      icon: <FileText size={13} />,
      disabled: isProcessing,
      onClick: () => handleFormatSelect("png"),
    },
    {
      id: "convert-jpeg",
      label: "Convert to JPEG...",
      icon: <FileText size={13} />,
      disabled: isProcessing,
      onClick: () => handleFormatSelect("jpeg"),
    },
    {
      id: "convert-webp",
      label: "Convert to WebP...",
      icon: <FileText size={13} />,
      disabled: isProcessing,
      onClick: () => handleFormatSelect("webp"),
    },
    {
      id: "convert-avif",
      label: "Convert to AVIF...",
      icon: <FileText size={13} />,
      disabled: isProcessing,
      onClick: () => handleFormatSelect("avif"),
    },
    { id: "sep-3", label: "", separator: true, onClick: () => {} },
    {
      id: "undo",
      label: "Undo",
      icon: <Undo2 size={13} />,
      disabled: !canUndo || isProcessing,
      onClick: onUndo,
    },
    ...(hasChanges
      ? [
          {
            id: "save",
            label: "Save",
            icon: <Save size={13} />,
            disabled: isProcessing,
            className: "text-accent",
            onClick: onSave,
          },
        ]
      : []),
    { id: "sep-4", label: "", separator: true, onClick: () => {} },
    {
      id: "reveal",
      label: "Show in Finder",
      icon: <FolderOpen size={13} />,
      onClick: () => handleRevealInFolder?.(filePath),
    },
    {
      id: "copy-path",
      label: "Copy Path",
      icon: <Copy size={13} />,
      onClick: () => void handleCopyPath(),
    },
  ];

  return (
    <>
      <ContextMenu isOpen position={{ x, y }} items={items} onClose={onClose} />

      {formatDialogState.format && (
        <ImageFormatDialog
          isOpen={formatDialogState.isOpen}
          onClose={handleDialogClose}
          onConvert={handleConvert}
          format={formatDialogState.format}
          currentImageSrc={currentImageSrc}
          currentFileName={currentFileName}
        />
      )}
    </>
  );
}
