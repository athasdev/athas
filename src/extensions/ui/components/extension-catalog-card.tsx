import type { KeyboardEvent, MouseEvent } from "react";
import {
  ArrowClockwiseIcon as Refresh,
  CheckIcon as Check,
  PlusIcon as Plus,
  WarningCircleIcon as Warning,
  XCircleIcon as Unavailable,
} from "@/ui/icons";
import Badge from "@/ui/badge";
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from "@/ui/card";
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
    <Warning className="size-4 text-destructive" weight="duotone" />
  ) : hasUpdate ? (
    <Refresh className="size-4 text-primary" weight="duotone" />
  ) : isUnavailableAgent ? (
    <Unavailable className="size-4 text-subtle-foreground" weight="duotone" />
  ) : extension.isInstalled ? (
    <Check className="size-4 text-primary" weight="bold" />
  ) : (
    <Plus className="size-4 text-subtle-foreground" />
  );

  return (
    <Card
      variant="muted"
      size="sm"
      className="cursor-default transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
      onClick={onSelect}
      onContextMenu={(event) => onContextMenu(event, extension)}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
    >
      <CardHeader className="grid-cols-[auto_1fr_auto] gap-x-3">
        <div className="row-span-2">
          <ExtensionIcon extension={extension} />
        </div>
        <CardTitle className="min-w-0 truncate">{extension.name}</CardTitle>
        <CardAction className="col-start-3 flex items-center gap-2">
          {extension.isBundled ? (
            <Badge variant="accent" size="compact">
              Built-in
            </Badge>
          ) : null}
          <span className="flex size-5 items-center justify-center">{status}</span>
        </CardAction>
        <CardDescription className="line-clamp-2 min-h-10">{extension.description}</CardDescription>
      </CardHeader>
      <div className="flex min-w-0 items-center gap-2 px-(--card-spacing) text-subtle-foreground ui-text-sm">
        <Badge variant="muted" size="compact">
          {getCategoryLabel(extension.category)}
        </Badge>
        {extension.publisher ? <span className="truncate">{extension.publisher}</span> : null}
        {extension.version ? <span className="ml-auto shrink-0">v{extension.version}</span> : null}
      </div>
    </Card>
  );
}
