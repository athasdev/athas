import type { ReactNode } from "react";
import { EyeIcon, SearchIcon } from "@/ui/icons";
import { useShallow } from "zustand/react/shallow";
import { EditorStatusActions } from "@/features/editor/components/toolbar/editor-status-actions";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { openMarkdownPreview } from "@/features/editor/markdown/open-markdown-preview";
import { isMarkdownPreviewableFile } from "@/features/editor/markdown/previewable";
import { getBufferById } from "@/features/editor/utils/buffer-index";
import { keymapRegistry } from "@/features/keymaps/utils/registry";
import { useExtensionActions } from "@/extensions/ui/hooks/use-extension-actions";
import { ExtensionToolbarAction } from "@/extensions/ui/components/extension-toolbar-action";
import { PaneContentHeader } from "@/features/panes/components/pane-content-chrome";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { Button } from "@/ui/button";
import { FilePathBreadcrumb } from "./file-path-breadcrumb";
import { SymbolBreadcrumb } from "./symbol-breadcrumb";

export interface BreadcrumbProps {
  bufferId?: string;
  editorViewKey?: string | null;
  filePathOverride?: string;
  leadingContent?: ReactNode;
  rightContent?: ReactNode;
  extraLeftContent?: ReactNode;
  showDefaultActions?: boolean;
  interactive?: boolean;
  showPath?: boolean;
}

export default function Breadcrumb({
  bufferId,
  editorViewKey,
  filePathOverride,
  leadingContent,
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
            type: buffer.type,
          }
        : null;
    }),
  );
  const showBreadcrumbPath = useSettingsStore((state) => state.settings.coreFeatures.breadcrumbs);
  const extensionActions = useExtensionActions();

  const handleSearchClick = () => {
    void keymapRegistry.executeCommand("workbench.showFind");
  };

  const handlePreviewClick = () => {
    const buffer = useBufferStore.getState().buffers.find((item) => item.id === resolvedBufferId);
    if (buffer?.type === "editor") openMarkdownPreview(buffer);
  };

  const filePath = filePathOverride ?? activeBuffer?.path ?? "";
  if (!filePath) return null;
  const isLocalHistorySnapshot = filePath.startsWith("local-history://");

  const defaultActions =
    showDefaultActions && activeBuffer ? (
      <>
        {activeBuffer.type === "editor" && isMarkdownPreviewableFile(activeBuffer.path) ? (
          <Button variant="ghost" iconOnly onClick={handlePreviewClick} tooltip="Preview Markdown">
            <EyeIcon />
          </Button>
        ) : null}
        {activeBuffer.type === "editor" ? (
          <Button
            variant="ghost"
            iconOnly
            onClick={handleSearchClick}
            commandId="workbench.showFind"
            tooltip="Find in file"
          >
            <SearchIcon />
          </Button>
        ) : null}
        <EditorStatusActions bufferId={resolvedBufferId ?? undefined} />
      </>
    ) : null;

  return (
    <PaneContentHeader
      separated={false}
      className="select-none"
      leading={leadingContent}
      context={
        <div className="font-sans flex min-w-0 items-center gap-1 text-subtle-foreground ui-text-sm">
          {showPath && showBreadcrumbPath ? (
            <>
              <FilePathBreadcrumb
                filePath={filePath}
                interactive={interactive && !isLocalHistorySnapshot}
              />
              <SymbolBreadcrumb
                bufferId={resolvedBufferId ?? undefined}
                editorViewKey={editorViewKey}
                filePath={filePath}
                interactive={interactive && !isLocalHistorySnapshot}
              />
            </>
          ) : null}
          {extensionActions.left.map((action) => (
            <ExtensionToolbarAction key={action.id} action={action} />
          ))}
          {extraLeftContent}
        </div>
      }
      actions={
        <>
          {defaultActions}
          {defaultActions && rightContent ? <div className="mx-1 h-3.5 w-px bg-border" /> : null}
          {rightContent}
          {extensionActions.right.map((action) => (
            <ExtensionToolbarAction key={action.id} action={action} />
          ))}
        </>
      }
    />
  );
}
