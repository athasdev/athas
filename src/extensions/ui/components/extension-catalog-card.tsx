import type { KeyboardEvent, MouseEvent } from "react";
import {
  ArrowClockwiseIcon,
  CheckIcon,
  PackageIcon,
  PlusIcon,
  TagIcon,
  UserIcon,
  WarningCircleIcon,
  XCircleIcon,
} from "@/ui/icons";
import { Card, CardContent, CardDescription, CardTitle } from "@/ui/card";
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
    <WarningCircleIcon className="size-4 text-destructive" />
  ) : hasUpdate ? (
    <ArrowClockwiseIcon className="size-4 text-primary" />
  ) : isUnavailableAgent ? (
    <XCircleIcon className="size-4 text-subtle-foreground" />
  ) : extension.isInstalled ? (
    <CheckIcon className="size-4 text-primary" optical="md" />
  ) : (
    <PlusIcon className="size-4 text-subtle-foreground" />
  );

  return (
    <Card
      variant="interactive"
      className="min-w-0"
      onClick={onSelect}
      onContextMenu={(event) => onContextMenu(event, extension)}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
    >
      <CardContent className="grid min-w-0 grid-cols-[2.5rem_minmax(0,1fr)_1.25rem] items-center gap-x-3">
        <ExtensionIcon extension={extension} />
        <div className="min-w-0">
          <CardTitle className="truncate">{extension.name}</CardTitle>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-subtle-foreground ui-text-sm">
            <span className="flex shrink-0 items-center gap-1">
              <TagIcon className="size-3.5" />
              {getCategoryLabel(extension.category)}
            </span>
            {extension.publisher ? (
              <span className="flex min-w-0 items-center gap-1">
                <UserIcon className="size-3.5 shrink-0" />
                <span className="truncate">{extension.publisher}</span>
              </span>
            ) : null}
            {extension.isBundled ? (
              <span className="flex shrink-0 items-center gap-1">
                <PackageIcon className="size-3.5" />
                Built-in
              </span>
            ) : null}
          </div>
        </div>
        <span
          className="flex size-5 items-center justify-center justify-self-end"
          aria-label={
            isInstalling
              ? "Installing"
              : hasRuntimeIssue
                ? "Runtime issue"
                : hasUpdate
                  ? "Update available"
                  : isUnavailableAgent
                    ? "Unavailable"
                    : extension.isInstalled
                      ? "Installed"
                      : "Available to install"
          }
        >
          {status}
        </span>
        {extension.description ? (
          <CardDescription className="col-span-3 mt-3 line-clamp-2">
            {extension.description}
          </CardDescription>
        ) : null}
      </CardContent>
    </Card>
  );
}
