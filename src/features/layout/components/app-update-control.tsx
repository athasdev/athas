import { useMemo, useRef, useState } from "react";
import {
  chromeControl,
  chromeControlGroup,
} from "@/features/layout/components/chrome-control-styles";
import { useAutoUpdate } from "@/features/settings/hooks/use-auto-update";
import { Button } from "@/ui/button";
import { Dropdown } from "@/ui/dropdown";
import { LoadingIndicator } from "@/ui/loading";
import { CaretDownIcon, DownloadIcon } from "@/ui/icons";
import { TabsList } from "@/ui/tabs";
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
        onClick: onViewReleaseNotes,
        disabled: updateBusy,
      },
      {
        id: "download-later",
        label: "Download Later",
        onClick: dismissUpdate,
        disabled: updateBusy,
      },
      {
        id: "remind-later",
        label: "Remind Me Tomorrow",
        onClick: onRemindLater,
        disabled: updateBusy,
      },
      {
        id: "skip-version",
        label: `Skip ${updateInfo?.version ?? "Version"}`,
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
      <TabsList variant="segmented" className={chromeControlGroup()}>
        <Button
          type="button"
          variant="ghost"
          compact
          tooltip={updateTooltip}
          tooltipSide="bottom"
          disabled={updateBusy}
          onClick={() => {
            if (!updateBusy) {
              void downloadAndInstall();
            }
          }}
          className={cn(
            chromeControl({ shape: "pill" }),
            "ui-font ui-text-sm font-medium",
            updateError ? "text-error hover:text-error" : "text-accent hover:text-accent",
            updateBusy &&
              "cursor-wait bg-accent/15 text-accent hover:bg-accent/20 hover:text-accent",
          )}
        >
          {updateBusy ? (
            <LoadingIndicator label={downloading ? "Downloading" : "Installing"} compact />
          ) : (
            <DownloadIcon />
          )}
          <span>{updateLabel}</span>
        </Button>
      </TabsList>
      <div ref={updateMenuRef}>
        <TabsList variant="segmented" className={chromeControlGroup()}>
          <Button
            type="button"
            variant="ghost"
            compact
            active={isUpdateMenuOpen}
            tooltip="Update Options"
            tooltipSide="bottom"
            onClick={() => setIsUpdateMenuOpen((open) => !open)}
            className={cn(
              chromeControl(),
              updateError ? "text-error hover:text-error" : "text-accent hover:text-accent",
            )}
          >
            <CaretDownIcon />
          </Button>
        </TabsList>
      </div>
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
