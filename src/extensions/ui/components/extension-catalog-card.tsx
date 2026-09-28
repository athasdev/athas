import type { KeyboardEvent, MouseEvent } from "react";
import Badge from "@/ui/badge";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/ui/item";
import { Spinner } from "@/ui/spinner";
import { ExtensionIcon } from "./extension-catalog-icon";
import type { UnifiedExtension } from "./extension-catalog-types";
import { getCategoryLabel } from "./extension-catalog-utils";

export function ExtensionCatalogCard({
  extension,
  onContextMenu,
  onSelect,
  isInstalling,
  hasUpdate,
  hasRuntimeIssue,
}: {
  extension: UnifiedExtension;
  onContextMenu: (event: MouseEvent<HTMLElement>, extension: UnifiedExtension) => void;
  onSelect: () => void;
  isInstalling?: boolean;
  hasUpdate?: boolean;
  hasRuntimeIssue?: boolean;
}) {
  const isUnavailableAgent =
    extension.category === "agent" && !extension.isInstalled && extension.canInstall === false;
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onSelect();
  };

  const status = isInstalling ? (
    <Spinner label="Installing" compact />
  ) : hasRuntimeIssue ? (
    <Badge tone="danger">Issue</Badge>
  ) : hasUpdate ? (
    <Badge tone="accent">Update</Badge>
  ) : isUnavailableAgent ? (
    <Badge>Unavailable</Badge>
  ) : extension.isInstalled ? (
    <Badge tone="success">Installed</Badge>
  ) : null;

  return (
    <Item
      variant="list"
      interactive
      className="min-w-0 flex-nowrap"
      onClick={onSelect}
      onContextMenu={(event) => onContextMenu(event, extension)}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
    >
      <ItemMedia>
        <ExtensionIcon extension={extension} />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{extension.name}</ItemTitle>
        <ItemDescription>
          {extension.description || getCategoryLabel(extension.category)}
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        {extension.isBundled ? (
          <span className="text-subtle-foreground ui-text-sm max-[520px]:hidden">Built-in</span>
        ) : null}
        {status}
      </ItemActions>
    </Item>
  );
}
