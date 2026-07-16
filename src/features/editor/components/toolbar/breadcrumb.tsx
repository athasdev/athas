import { type ReactNode, useRef, useState } from "react";
import { DotsThreeIcon as MoreHorizontal } from "@/ui/icons";
import { useShallow } from "zustand/react/shallow";
import { EditorStatusActions } from "@/features/editor/components/toolbar/editor-status-actions";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { getBufferById } from "@/features/editor/utils/buffer-index";
import { useInlineEditToolbarStore } from "@/features/editor/stores/inline-edit-toolbar.store";
import { hasTextContent } from "@/features/panes/types/pane-content.types";
import { useUIState } from "@/features/window/stores/ui-state.store";
import { useExtensionActions } from "@/extensions/ui/hooks/use-extension-actions";
import { ExtensionToolbarAction } from "@/extensions/ui/components/extension-toolbar-action";
import { isMarkdownPreviewableFile } from "@/features/editor/markdown/previewable";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { Button, type ButtonProps } from "@/ui/button";
import { Dropdown, type MenuItem } from "@/ui/dropdown";
import { cn } from "@/utils/cn";
import { FilePathBreadcrumb } from "./file-path-breadcrumb";

export interface BreadcrumbProps {
  bufferId?: string;
  editorViewKey?: string | null;
  filePathOverride?: string;
  rightContent?: ReactNode;
  extraLeftContent?: ReactNode;
  showDefaultActions?: boolean;
  interactive?: boolean;
  showPath?: boolean;
}

type BreadcrumbActionButtonProps = Omit<ButtonProps, "variant" | "size">;

export function BreadcrumbActionButton({ className, ...props }: BreadcrumbActionButtonProps) {
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      className={cn("rounded text-text-lighter", className)}
      {...props}
    />
  );
}

export default function Breadcrumb({
  bufferId,
  editorViewKey,
  filePathOverride,
  rightContent,
  extraLeftContent,
  showDefaultActions = true,
  interactive = true,
  showPath = true,
}: BreadcrumbProps = {}) {
  const resolvedBufferId = useBufferStore((state) => bufferId ?? state.activeBufferId);
  const activeBuffer = useBufferStore(
    useShallow((state) => {
      const buffer = getBufferById(state.buffers, resolvedBufferId);
      return buffer
        ? {
            id: buffer.id,
            path: buffer.path,
            name: buffer.name,
            type: buffer.type,
          }
        : null;
    }),
  );
  const showBreadcrumbPath = useSettingsStore((state) => state.settings.coreFeatures.breadcrumbs);
  const { isFindVisible, setIsFindVisible } = useUIState(
    useShallow((state) => ({
      isFindVisible: state.isFindVisible,
      setIsFindVisible: state.setIsFindVisible,
    })),
  );
  const inlineEditActions = useInlineEditToolbarStore.use.actions();
  const extensionActions = useExtensionActions();
  const [isActionsMenuOpen, setIsActionsMenuOpen] = useState(false);
  const actionsButtonRef = useRef<HTMLButtonElement>(null);

  const handleSearchClick = () => {
    setIsFindVisible(!isFindVisible);
  };

  const handleInlineEditClick = () => {
    inlineEditActions.show(editorViewKey ?? resolvedBufferId ?? null);
  };

  const isMarkdownFile = () => {
    if (!activeBuffer) return false;
    return isMarkdownPreviewableFile(activeBuffer.path);
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
    const fullActiveBuffer = resolvedBufferId
      ? useBufferStore.getState().buffers.find((buffer) => buffer.id === resolvedBufferId)
      : null;
    if (
      !fullActiveBuffer ||
      fullActiveBuffer.type === "markdownPreview" ||
      fullActiveBuffer.type === "htmlPreview" ||
      fullActiveBuffer.type === "csvPreview"
    )
      return;

    const { openBuffer } = useBufferStore.getState().actions;
    const previewPath = `${fullActiveBuffer.path}:preview`;
    const previewName = `${fullActiveBuffer.name} (Preview)`;

    const isMarkdown = isMarkdownFile();
    const isHtml = isHtmlFile();
    const isCsv = isCsvFile();

    const bufferContent = hasTextContent(fullActiveBuffer) ? fullActiveBuffer.content : "";

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
      fullActiveBuffer.path, // sourceFilePath
    );
  };

  const filePath = filePathOverride ?? activeBuffer?.path ?? "";
  const onSearchClick = handleSearchClick;
  if (!filePath) return null;
  const isLocalHistorySnapshot = filePath.startsWith("local-history://");

  const canPreview =
    (isMarkdownFile() && activeBuffer?.type !== "markdownPreview") ||
    (isHtmlFile() && activeBuffer?.type !== "htmlPreview") ||
    (isCsvFile() && activeBuffer?.type !== "csvPreview");

  const actionMenuItems: MenuItem[] = [
    ...(canPreview
      ? [
          {
            id: "preview",
            label: "Preview",
            onClick: handlePreviewClick,
          },
        ]
      : []),
    {
      id: "inline-edit",
      label: "AI inline edit",
      onClick: handleInlineEditClick,
    },
    {
      id: "find",
      label: "Find in file",
      onClick: onSearchClick,
    },
  ];

  const defaultActions =
    showDefaultActions && activeBuffer ? (
      <>
        <EditorStatusActions
          bufferId={resolvedBufferId ?? undefined}
          editorViewKey={editorViewKey}
        />
        <BreadcrumbActionButton
          ref={actionsButtonRef}
          onClick={() => setIsActionsMenuOpen((open) => !open)}
          active={isActionsMenuOpen}
          tooltip="Editor actions"
          tooltipSide="bottom"
        >
          <MoreHorizontal />
        </BreadcrumbActionButton>
        <Dropdown
          isOpen={isActionsMenuOpen}
          anchorRef={actionsButtonRef}
          anchorSide="bottom"
          anchorAlign="end"
          onClose={() => setIsActionsMenuOpen(false)}
          items={actionMenuItems}
          className="min-w-[180px] rounded-lg"
          density="compact"
          showIcons={false}
        />
      </>
    ) : null;

  return (
    <>
      <div className="flex min-h-7 select-none items-center justify-between bg-terniary-bg px-3 py-1">
        <div className="font-sans flex min-w-0 items-center gap-2 text-text-lighter ui-text-sm">
          {showPath && showBreadcrumbPath ? (
            <FilePathBreadcrumb
              filePath={filePath}
              interactive={interactive && !isLocalHistorySnapshot}
            />
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
