import type { ReactNode } from "react";
import { MagnifyingGlassIcon as Search } from "@/ui/icons";
import { useShallow } from "zustand/react/shallow";
import { EditorStatusActions } from "@/features/editor/components/toolbar/editor-status-actions";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { getBufferById } from "@/features/editor/utils/buffer-index";
import { keymapRegistry } from "@/features/keymaps/utils/registry";
import { useExtensionActions } from "@/extensions/ui/hooks/use-extension-actions";
import { ExtensionToolbarAction } from "@/extensions/ui/components/extension-toolbar-action";
import { PaneContentHeader } from "@/features/panes/components/pane-content-chrome";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { Button, type ButtonProps } from "@/ui/button";
import { cn } from "@/utils/cn";
import { FilePathBreadcrumb } from "./file-path-breadcrumb";
import { SymbolBreadcrumb } from "./symbol-breadcrumb";

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

type BreadcrumbActionButtonProps = Omit<ButtonProps, "variant">;

export function BreadcrumbActionButton({ className, ...props }: BreadcrumbActionButtonProps) {
  return (
    <Button
      variant="ghost"
      iconOnly
      className={cn("text-subtle-foreground", className)}
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

  const filePath = filePathOverride ?? activeBuffer?.path ?? "";
  if (!filePath) return null;
  const isLocalHistorySnapshot = filePath.startsWith("local-history://");

  const defaultActions =
    showDefaultActions && activeBuffer ? (
      <>
        {activeBuffer.type === "editor" ? (
          <BreadcrumbActionButton
            onClick={handleSearchClick}
            commandId="workbench.showFind"
            tooltip="Find in file"
            tooltipSide="bottom"
          >
            <Search />
          </BreadcrumbActionButton>
        ) : null}
        <EditorStatusActions bufferId={resolvedBufferId ?? undefined} />
      </>
    ) : null;

  return (
    <PaneContentHeader
      separated={false}
      className="select-none"
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
          {defaultActions && rightContent ? <div className="mx-1 h-3.5 w-px bg-border/70" /> : null}
          {rightContent}
          {extensionActions.right.map((action) => (
            <ExtensionToolbarAction key={action.id} action={action} />
          ))}
        </>
      }
    />
  );
}
