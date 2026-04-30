import type { ReactNode } from "react";
import { Eye, MagnifyingGlass as Search, Sparkle as Sparkles } from "@phosphor-icons/react";
import { EditorStatusActions } from "@/features/editor/components/toolbar/editor-status-actions";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useInlineEditToolbarStore } from "@/features/editor/stores/inline-edit-toolbar-store";
import type { Position } from "@/features/editor/types/editor";
import { hasTextContent } from "@/features/panes/types/pane-content";
import { useUIState } from "@/features/window/stores/ui-state-store";
import { useExtensionActions } from "@/extensions/ui/hooks/use-extension-actions";
import { ExtensionToolbarAction } from "@/extensions/ui/components/extension-toolbar-action";
import { useSettingsStore } from "@/features/settings/store";
import { Button } from "@/ui/button";
import { FilePathBreadcrumb } from "./file-path-breadcrumb";

export interface BreadcrumbProps {
  bufferId?: string;
  cursorPosition?: Position;
  filePathOverride?: string;
  rightContent?: ReactNode;
  extraLeftContent?: ReactNode;
  showDefaultActions?: boolean;
  interactive?: boolean;
  showPath?: boolean;
}

export default function Breadcrumb({
  bufferId,
  cursorPosition,
  filePathOverride,
  rightContent,
  extraLeftContent,
  showDefaultActions = true,
  interactive = true,
  showPath = true,
}: BreadcrumbProps = {}) {
  const buffers = useBufferStore.use.buffers();
  const activeBufferId = useBufferStore.use.activeBufferId();
  const resolvedBufferId = bufferId ?? activeBufferId;
  const activeBuffer = buffers.find((b) => b.id === resolvedBufferId) || null;
  const showBreadcrumbPath = useSettingsStore((state) => state.settings.coreFeatures.breadcrumbs);
  const { isFindVisible, setIsFindVisible } = useUIState();
  const inlineEditActions = useInlineEditToolbarStore.use.actions();
  const extensionActions = useExtensionActions();

  const handleSearchClick = () => {
    setIsFindVisible(!isFindVisible);
  };

  const handleInlineEditClick = () => {
    inlineEditActions.show();
  };

  const isMarkdownFile = () => {
    if (!activeBuffer) return false;
    const extension = activeBuffer.path.split(".").pop()?.toLowerCase();
    return extension === "md" || extension === "markdown";
  };

  const isHtmlFile = () => {
    if (!activeBuffer) return false;
    const extension = activeBuffer.path.split(".").pop()?.toLowerCase();
    return extension === "html" || extension === "htm";
  };

  const isCsvFile = () => {
    if (!activeBuffer) return false;
    const extension = activeBuffer.path.split(".").pop()?.toLowerCase();
    return extension === "csv";
  };

  const handlePreviewClick = () => {
    if (
      !activeBuffer ||
      activeBuffer.type === "markdownPreview" ||
      activeBuffer.type === "htmlPreview" ||
      activeBuffer.type === "csvPreview"
    )
      return;

    const { openBuffer } = useBufferStore.getState().actions;
    const previewPath = `${activeBuffer.path}:preview`;
    const previewName = `${activeBuffer.name} (Preview)`;

    const isMarkdown = isMarkdownFile();
    const isHtml = isHtmlFile();
    const isCsv = isCsvFile();

    const bufferContent = hasTextContent(activeBuffer) ? activeBuffer.content : "";

    openBuffer(
      previewPath,
      previewName,
      bufferContent,
      false, // isImage
      undefined, // databaseType
      false, // isDiff
      true, // isVirtual
      undefined, // diffData
      isMarkdown, // isMarkdownPreview
      isHtml, // isHtmlPreview
      isCsv, // isCsvPreview
      activeBuffer.path, // sourceFilePath
    );
  };

  const filePath = filePathOverride ?? activeBuffer?.path ?? "";
  const onSearchClick = handleSearchClick;
  if (!filePath) return null;

  const defaultActions =
    showDefaultActions && activeBuffer ? (
      <>
        {((isMarkdownFile() && activeBuffer.type !== "markdownPreview") ||
          (isHtmlFile() && activeBuffer.type !== "htmlPreview") ||
          (isCsvFile() && activeBuffer.type !== "csvPreview")) && (
          <Button
            onClick={handlePreviewClick}
            variant="ghost"
            size="icon-xs"
            className="rounded text-text-lighter"
            tooltip="Preview"
            tooltipSide="bottom"
          >
            <Eye />
          </Button>
        )}
        <Button
          onClick={handleInlineEditClick}
          variant="ghost"
          size="icon-xs"
          className="rounded text-text-lighter"
          tooltip="AI inline edit"
          commandId="editor.inlineEdit"
          tooltipSide="bottom"
        >
          <Sparkles />
        </Button>
        <Button
          onClick={onSearchClick}
          variant="ghost"
          size="icon-xs"
          className="rounded text-text-lighter"
          tooltip="Find in file"
          commandId="workbench.showFind"
          tooltipSide="bottom"
        >
          <Search />
        </Button>
        <div className="mx-1 h-3.5 w-px bg-border/70" />
        <EditorStatusActions
          bufferId={resolvedBufferId ?? undefined}
          cursorPosition={cursorPosition}
        />
      </>
    ) : null;

  return (
    <>
      <div className="flex min-h-7 select-none items-center justify-between bg-terniary-bg px-3 py-1">
        <div className="ui-font flex min-w-0 items-center gap-2 text-text-lighter text-xs">
          {showPath && showBreadcrumbPath ? (
            <FilePathBreadcrumb filePath={filePath} interactive={interactive} />
          ) : null}
          {extensionActions.left.map((action) => (
            <ExtensionToolbarAction key={action.id} action={action} />
          ))}
          {extraLeftContent}
        </div>
        <div className="flex items-center gap-1">
          {defaultActions}
          {defaultActions && rightContent ? <div className="mx-1 h-3.5 w-px bg-border/70" /> : null}
          {rightContent}
          {extensionActions.right.map((action) => (
            <ExtensionToolbarAction key={action.id} action={action} />
          ))}
        </div>
      </div>
    </>
  );
}
