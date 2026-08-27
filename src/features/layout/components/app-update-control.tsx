import { useMemo, useRef, useState } from "react";
import { useAutoUpdate } from "@/features/settings/hooks/use-auto-update";
import { Dropdown } from "@/ui/dropdown";
import { Spinner } from "@/ui/spinner";
import { CalendarIcon, ClockIcon, DownloadIcon, FileTextIcon, XCircleIcon } from "@/ui/icons";
import { SidebarIconButton, SidebarListItem } from "@/ui/sidebar";
import Tooltip from "@/ui/tooltip";

interface AppUpdateControlProps {
  expanded: boolean;
}

export function AppUpdateControl({ expanded }: AppUpdateControlProps) {
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
    <div ref={updateMenuRef} className="w-full">
      {expanded ? (
        <SidebarListItem
          leading={
            updateBusy ? (
              <Spinner label={downloading ? "Downloading" : "Installing"} compact />
            ) : (
              <DownloadIcon />
            )
          }
          active={isUpdateMenuOpen}
          disabled={updateBusy}
          onClick={() => setIsUpdateMenuOpen((open) => !open)}
          aria-haspopup="menu"
          aria-expanded={isUpdateMenuOpen}
          aria-label={updateTooltip}
        >
          {updateLabel}
        </SidebarListItem>
      ) : (
        <Tooltip content={updateTooltip} side="right">
          <SidebarIconButton
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
          </SidebarIconButton>
        </Tooltip>
      )}
      <Dropdown
        isOpen={isUpdateMenuOpen}
        onClose={() => setIsUpdateMenuOpen(false)}
        anchorRef={updateMenuRef}
        anchorSide="top"
        anchorAlign="start"
        items={updateMenuItems}
        className="min-w-52"
      />
    </div>
  );
}
