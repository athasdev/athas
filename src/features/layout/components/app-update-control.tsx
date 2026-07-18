import { useMemo, useRef, useState } from "react";
import { useAutoUpdate } from "@/features/settings/hooks/use-auto-update";
import { Button } from "@/ui/button";
import { ButtonGroup, ButtonGroupSeparator } from "@/ui/button-group";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/ui/context-menu";
import { Dropdown } from "@/ui/dropdown";
import { Spinner } from "@/ui/spinner";
import {
  CalendarIcon,
  CaretDownIcon,
  ClockIcon,
  DownloadIcon,
  FileTextIcon,
  XCircleIcon,
} from "@/ui/icons";
import { cn } from "@/utils/cn";

export function AppUpdateControl() {
  const {
    showUpdateIndicator,
    downloading,
    installing,
    error: updateError,
    updateInfo,
    downloadProgress,
    onDownload: downloadAndInstall,
    onDismiss: dismissUpdate,
    onRemindLater,
    onSkipVersion,
    onViewReleaseNotes,
  } = useAutoUpdate();
  const [isUpdateMenuOpen, setIsUpdateMenuOpen] = useState(false);
  const updateMenuRef = useRef<HTMLDivElement>(null);
  const updateBusy = downloading || installing;

  const updateMenuItems = useMemo(
    () => [
      {
        id: "release-notes",
        label: "View Release Notes",
        icon: <FileTextIcon />,
        onClick: onViewReleaseNotes,
        disabled: updateBusy,
      },
      {
        id: "download-later",
        label: "Download Later",
        icon: <ClockIcon />,
        onClick: dismissUpdate,
        disabled: updateBusy,
      },
      {
        id: "remind-later",
        label: "Remind Me Tomorrow",
        icon: <CalendarIcon />,
        onClick: onRemindLater,
        disabled: updateBusy,
      },
      {
        id: "skip-version",
        label: `Skip ${updateInfo?.version ?? "Version"}`,
        icon: <XCircleIcon />,
        onClick: onSkipVersion,
        disabled: updateBusy,
      },
    ],
    [
      dismissUpdate,
      onRemindLater,
      onSkipVersion,
      onViewReleaseNotes,
      updateBusy,
      updateInfo?.version,
    ],
  );

  if (!showUpdateIndicator || !updateInfo) return null;

  const updateLabel = downloading
    ? `${downloadProgress?.percentage ?? 0}%`
    : installing
      ? "Installing"
      : updateError
        ? "Update failed"
        : "Update available";
  const updateTooltip = updateError
    ? updateError
    : downloading
      ? `Updating Athas ${downloadProgress?.percentage ?? 0}%`
      : installing
        ? "Installing update..."
        : `Update available: ${updateInfo.version}`;

  return (
    <div className="flex items-center gap-0.5">
      <ButtonGroupSeparator className="mx-1.5" />
      <ContextMenu>
        <ContextMenuTrigger
          className="contents"
          onContextMenu={(event) => {
            event.stopPropagation();
            setIsUpdateMenuOpen(false);
          }}
        >
          <ButtonGroup ref={updateMenuRef}>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              tooltip={updateTooltip}
              tooltipSide="bottom"
              disabled={updateBusy}
              onClick={() => {
                if (!updateBusy) {
                  void downloadAndInstall();
                }
              }}
              className={cn(
                "font-sans ui-text-sm font-medium",
                updateError ? "text-error hover:text-error" : "text-accent hover:text-accent",
                updateBusy &&
                  "cursor-wait bg-accent/15 text-accent hover:bg-accent/20 hover:text-accent",
              )}
            >
              {updateBusy ? (
                <Spinner label={downloading ? "Downloading" : "Installing"} compact />
              ) : (
                <DownloadIcon />
              )}
              <span>{updateLabel}</span>
            </Button>
            <ButtonGroupSeparator />
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              active={isUpdateMenuOpen}
              tooltip="Update Options"
              tooltipSide="bottom"
              onClick={() => setIsUpdateMenuOpen((open) => !open)}
              className={
                updateError ? "text-error hover:text-error" : "text-accent hover:text-accent"
              }
              aria-label="Update options"
              aria-haspopup="menu"
              aria-expanded={isUpdateMenuOpen}
            >
              <CaretDownIcon />
            </Button>
          </ButtonGroup>
        </ContextMenuTrigger>
        <ContextMenuContent side="bottom" align="start" sideOffset={4} className="min-w-52">
          {updateMenuItems.map((item) => (
            <ContextMenuItem key={item.id} disabled={item.disabled} onClick={item.onClick}>
              {item.icon}
              {item.label}
            </ContextMenuItem>
          ))}
        </ContextMenuContent>
      </ContextMenu>
      <Dropdown
        isOpen={isUpdateMenuOpen}
        onClose={() => setIsUpdateMenuOpen(false)}
        anchorRef={updateMenuRef}
        anchorSide="bottom"
        anchorAlign="end"
        items={updateMenuItems}
        className="min-w-52"
      />
    </div>
  );
}
