import type { MouseEvent } from "react";
import {
  ArrowClockwiseIcon as RefreshCw,
  CheckIcon as Check,
  PlusIcon as Plus,
  WarningCircleIcon as WarningCircle,
  XCircleIcon as XCircle,
} from "@/ui/icons";
import { SidebarListItem } from "@/ui/sidebar";
import { Spinner } from "@/ui/spinner";
import { ExtensionInlineIcon } from "./extension-catalog-icon";
import type { UnifiedExtension } from "./extension-catalog-types";

export function ExtensionListItem({
  extension,
  onContextMenu,
  onSelect,
  selected,
  isInstalling,
  hasUpdate,
  hasRuntimeIssue,
}: {
  extension: UnifiedExtension;
  onContextMenu: (event: MouseEvent<HTMLElement>, extension: UnifiedExtension) => void;
  onSelect: () => void;
  selected?: boolean;
  isInstalling?: boolean;
  hasUpdate?: boolean;
  hasRuntimeIssue?: boolean;
}) {
  const isUnavailableAgent =
    extension.category === "agent" && !extension.isInstalled && extension.canInstall === false;
  const status = isInstalling ? (
    <Spinner label="Installing" compact />
  ) : hasRuntimeIssue ? (
    <WarningCircle className="size-4 text-destructive" weight="duotone" />
  ) : hasUpdate ? (
    <RefreshCw className="size-4 text-primary" weight="duotone" />
  ) : isUnavailableAgent ? (
    <XCircle className="size-4" weight="duotone" />
  ) : extension.isInstalled ? (
    <Check className="size-4" weight="bold" />
  ) : (
    <Plus className="size-4" />
  );

  return (
    <SidebarListItem
      active={selected}
      leading={<ExtensionInlineIcon extension={extension} />}
      description={extension.description}
      trailing={
        <span className="flex size-5 shrink-0 items-center justify-center text-subtle-foreground">
          {status}
        </span>
      }
      onClick={onSelect}
      onContextMenu={(event) => onContextMenu(event, extension)}
    >
      {extension.name}
    </SidebarListItem>
  );
}
