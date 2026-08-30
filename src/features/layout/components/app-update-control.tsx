import { useMemo, useRef, useState } from "react";
import { useAutoUpdate } from "@/features/settings/hooks/use-auto-update";
import { Button } from "@/ui/button";
import { Dropdown } from "@/ui/dropdown";
import { Spinner } from "@/ui/spinner";
import { CalendarIcon, ClockIcon, DownloadIcon, FileTextIcon, XCircleIcon } from "@/ui/icons";
import Tooltip from "@/ui/tooltip";

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
        id: "install-update",
        label: `Install Athas ${updateInfo?.version ?? "Update"}`,
        icon: <DownloadIcon />,
        onClick: downloadAndInstall,
        disabled: updateBusy,
      },
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
      downloadAndInstall,
      onRemindLater,
      onSkipVersion,
      onViewReleaseNotes,
      updateBusy,
      updateInfo?.version,
    ],
  );

  if (!showUpdateIndicator || !updateInfo) return null;

  const updateTooltip = updateError
    ? updateError
    : downloading
      ? `Updating Athas ${downloadProgress?.percentage ?? 0}%`
      : installing
        ? "Installing update..."
        : `Update available: ${updateInfo.version}`;

  return (
    <div ref={updateMenuRef}>
      <Tooltip content={updateTooltip} side="bottom">
        <Button
          type="button"
          variant="ghost"
          iconOnly
          size="chrome"
          active={isUpdateMenuOpen}
          disabled={updateBusy}
          onClick={() => setIsUpdateMenuOpen((open) => !open)}
          aria-haspopup="menu"
          aria-expanded={isUpdateMenuOpen}
          aria-label={updateTooltip}
        >
          {updateBusy ? (
            <Spinner label={downloading ? "Downloading" : "Installing"} compact />
          ) : (
            <DownloadIcon />
          )}
        </Button>
      </Tooltip>
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
