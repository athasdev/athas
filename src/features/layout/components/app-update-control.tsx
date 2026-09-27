import { useMemo } from "react";
import { useAutoUpdate } from "@/features/settings/hooks/use-auto-update";
import { useWhatsNewStore } from "@/features/settings/stores/whats-new.store";
import { Button } from "@/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItems,
  DropdownMenuTrigger,
} from "@/ui/dropdown";
import { Spinner } from "@/ui/spinner";
import { ClockIcon, DownloadIcon, FileTextIcon } from "@/ui/icons";

export function AppUpdateControl({ compact = false }: { compact?: boolean }) {
  const hasUnreadWhatsNew = useWhatsNewStore((state) => state.hasUnread);
  const openWhatsNew = useWhatsNewStore((state) => state.actions.open);
  const {
    showUpdateIndicator,
    downloading,
    installing,
    error: updateError,
    updateInfo,
    downloadProgress,
    onDownload: downloadAndInstall,
    onRemindLater,
    onViewReleaseNotes,
  } = useAutoUpdate();
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
        label: "View release notes",
        icon: <FileTextIcon />,
        onClick: onViewReleaseNotes,
        disabled: updateBusy,
      },
      {
        id: "download-later",
        label: "Download later",
        icon: <ClockIcon />,
        onClick: onRemindLater,
        disabled: updateBusy,
      },
    ],
    [downloadAndInstall, onRemindLater, onViewReleaseNotes, updateBusy, updateInfo?.version],
  );

  if (!showUpdateIndicator || !updateInfo) {
    if (!hasUnreadWhatsNew) return null;

    return (
      <Button
        type="button"
        variant="ghost"
        size={compact ? "lg" : "sm"}
        onClick={() => void openWhatsNew()}
        tooltip="What's new in Athas"
        aria-label="What's new in Athas"
        iconOnly
      >
        <FileTextIcon />
      </Button>
    );
  }

  const updateTooltip = updateError
    ? updateError
    : downloading
      ? `Updating Athas ${downloadProgress?.percentage ?? 0}%`
      : installing
        ? "Installing update..."
        : `Update available: ${updateInfo.version}`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size={compact ? "lg" : "sm"}
            disabled={updateBusy}
            iconOnly={compact}
            aria-label={updateTooltip}
            tooltip={updateTooltip}
          />
        }
      >
        {updateBusy ? (
          <Spinner label={downloading ? "Downloading" : "Installing"} compact />
        ) : (
          <DownloadIcon />
        )}
        {!compact && <span>Update available</span>}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" size="default">
        <DropdownMenuItems items={updateMenuItems} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
