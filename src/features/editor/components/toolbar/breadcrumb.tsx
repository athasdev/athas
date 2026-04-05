import type { ReactNode } from "react";
import { Eye, Search, Sparkles } from "lucide-react";
import { EditorStatusActions } from "@/features/editor/components/toolbar/editor-status-actions";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useInlineEditToolbarStore } from "@/features/editor/stores/inline-edit-toolbar-store";
import { hasTextContent } from "@/features/panes/types/pane-content";
import { useUIState } from "@/features/window/stores/ui-state-store";
import { useExtensionActions } from "@/extensions/ui/hooks/use-extension-actions";
import { ExtensionToolbarAction } from "@/extensions/ui/components/extension-toolbar-action";
import { Button } from "@/ui/button";
import Tooltip from "@/ui/tooltip";
import { isMac } from "@/utils/platform";
import { FilePathBreadcrumb } from "./file-path-breadcrumb";

export interface BreadcrumbProps {
  filePathOverride?: string;
  rightContent?: ReactNode;
  extraLeftContent?: ReactNode;
  showDefaultActions?: boolean;
  interactive?: boolean;
}

export default function Breadcrumb({
  filePathOverride,
  rightContent,
  extraLeftContent,
  showDefaultActions = true,
  interactive = true,
}: BreadcrumbProps = {}) {
  const buffers = useBufferStore.use.buffers();
  const activeBufferId = useBufferStore.use.activeBufferId();
  const activeBuffer = buffers.find((b) => b.id === activeBufferId) || null;
  const { isFindVisible, setIsFindVisible } = useUIState();
  const inlineEditActions = useInlineEditToolbarStore.use.actions();
  const extensionActions = useExtensionActions();

  const inlineEditShortcutLabel = isMac() ? "Cmd+I" : "Ctrl+I";

  const handleSearchClick = () => {
    setIsFindVisible(!isFindVisible);
  };

  const handleInlineEditClick = () => {
    inlineEditActions.show();
  };

  const inlineEditTooltip = `AI inline edit (${inlineEditShortcutLabel})`;

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
          <Tooltip content="Preview" side="bottom">
            <Button
              onClick={handlePreviewClick}
              variant="ghost"
              size="icon-xs"
              className="rounded text-text-lighter"
              aria-label="Preview"
            >
              <Eye />
            </Button>
          </Tooltip>
        )}
        <Tooltip content={inlineEditTooltip} side="bottom">
          <Button
            onClick={handleInlineEditClick}
            variant="ghost"
            size="icon-xs"
            className="rounded text-text-lighter"
            aria-label={`AI inline edit (${inlineEditShortcutLabel})`}
          >
            <Sparkles />
          </Button>
        </Tooltip>
        <Tooltip content="Find in file" side="bottom">
          <Button
            onClick={onSearchClick}
            variant="ghost"
            size="icon-xs"
            className="rounded text-text-lighter"
            aria-label="Find in file"
          >
            <Search />
          </Button>
        </Tooltip>
        <div className="mx-1 h-3.5 w-px bg-border/70" />
        <EditorStatusActions />
      </>
    ) : null;

  return (
    <>
      <div className="flex min-h-7 select-none items-center justify-between bg-terniary-bg px-3 py-1">
        <div className="ui-font flex min-w-0 items-center gap-2 text-text-lighter text-xs">
          <FilePathBreadcrumb filePath={filePath} interactive={interactive} />
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
