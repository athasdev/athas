import { ChevronDownIcon as ChevronDown, ChevronRightIcon as ChevronRight } from "@/ui/icons";
import { memo, type ReactNode, useMemo } from "react";
import { ThemedFileIcon } from "@/extensions/icon-themes/components/themed-file-icon";
import { useEditorSettingsStore } from "@/features/editor/stores/settings.store";
import { calculateLineHeight } from "@/features/editor/utils/lines";
import { useZoomStore } from "@/features/window/stores/zoom.store";
import { cn } from "@/utils/cn";

interface MultibufferFileHeaderProps {
  filePath: string;
  fileName: string;
  directoryPath?: string;
  expanded?: boolean;
  onToggle?: () => void;
  onOpen: () => void;
  openAriaLabel?: string;
  fileNameClassName?: string;
  trailing?: ReactNode;
  actions?: ReactNode;
}

export const MultibufferFileHeader = memo(function MultibufferFileHeader({
  filePath,
  fileName,
  directoryPath,
  expanded = true,
  onToggle,
  onOpen,
  openAriaLabel = `Open ${filePath}`,
  fileNameClassName,
  trailing,
  actions,
}: MultibufferFileHeaderProps) {
  const editorFontSize = useEditorSettingsStore.use.fontSize();
  const editorFontFamily = useEditorSettingsStore.use.fontFamily();
  const editorLineHeight = useEditorSettingsStore.use.lineHeight();
  const zoomLevel = useZoomStore.use.editorZoomLevel();
  const fontSize = editorFontSize * zoomLevel;
  const lineHeight = calculateLineHeight(fontSize, editorLineHeight);
  const headerHeight = lineHeight + 6;
  const iconSize = Math.max(12, Math.min(16, Math.round(fontSize * 0.72)));
  const headerStyle = useMemo(
    () => ({
      fontSize: `${fontSize}px`,
      fontFamily: editorFontFamily,
      lineHeight: `${lineHeight}px`,
    }),
    [editorFontFamily, fontSize, lineHeight],
  );

  return (
    <div className="sticky top-0 z-50 min-w-0 max-w-full bg-primary-bg">
      <div
        className={cn(
          "min-w-0 max-w-full overflow-hidden border border-border/70 bg-primary-bg shadow-[0_1px_0_rgba(0,0,0,0.04)]",
          expanded ? "rounded-t-xl" : "rounded-xl",
        )}
      >
        <div
          className="font-mono code-editor-font-override flex min-w-0 items-center"
          style={headerStyle}
        >
          {onToggle ? (
            <button
              type="button"
              onClick={onToggle}
              className="relative z-50 flex shrink-0 items-center justify-center text-text-lighter hover:bg-hover/30 hover:text-text"
              style={{ width: `${headerHeight}px`, height: `${headerHeight}px` }}
              aria-label={expanded ? `Collapse ${fileName}` : `Expand ${fileName}`}
              aria-expanded={expanded}
            >
              {expanded ? <ChevronDown size={iconSize} /> : <ChevronRight size={iconSize} />}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onOpen}
            className={cn(
              "relative z-50 flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden py-0 pr-2 text-left hover:bg-hover/30",
              !onToggle && "pl-2",
            )}
            style={{ height: `${headerHeight}px` }}
            aria-label={openAriaLabel}
          >
            <ThemedFileIcon
              fileName={fileName}
              isDir={false}
              className="shrink-0 text-text-lighter"
            />
            <span className="flex min-w-0 flex-1 items-baseline gap-1.5 overflow-hidden">
              <span className={cn("min-w-0 max-w-[45%] truncate font-medium", fileNameClassName)}>
                {fileName}
              </span>
              {directoryPath ? (
                <span className="min-w-0 flex-1 truncate text-text-lighter">{directoryPath}</span>
              ) : null}
            </span>
            {trailing ? (
              <span className="ml-auto flex shrink-0 items-center gap-1.5 text-text-lighter">
                {trailing}
              </span>
            ) : null}
          </button>
          {actions ? (
            <div
              className="flex shrink-0 items-center pr-1.5 text-text-lighter"
              style={{ height: `${headerHeight}px` }}
            >
              {actions}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
});
