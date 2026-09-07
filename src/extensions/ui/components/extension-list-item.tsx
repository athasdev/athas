import type { MouseEvent } from "react";
import {
  ArrowClockwiseIcon,
  CheckIcon,
  PlusIcon,
  WarningCircleIcon,
  XCircleIcon,
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
    <WarningCircleIcon className="size-4 text-destructive" />
  ) : hasUpdate ? (
    <ArrowClockwiseIcon className="size-4 text-primary" />
  ) : isUnavailableAgent ? (
    <XCircleIcon className="size-4" />
  ) : extension.isInstalled ? (
    <CheckIcon className="size-4" optical="md" />
  ) : (
    <PlusIcon className="size-4" />
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
