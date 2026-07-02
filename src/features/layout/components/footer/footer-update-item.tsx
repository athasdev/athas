import {
  CaretUpIcon as CaretUp,
  DownloadSimpleIcon as DownloadSimple,
} from "@phosphor-icons/react";
import { useMemo, useRef, useState } from "react";
import type { FooterLeadingItemId } from "@/features/layout/config/item-order";
import { useAutoUpdate } from "@/features/settings/hooks/use-auto-update";
import { Dropdown } from "@/ui/dropdown";
import { LoadingIndicator } from "@/ui/loading";
import type { FooterItem } from "./footer-items";
import { FooterTabControl } from "./footer-tab-control";

export function useFooterUpdateItem(): FooterItem<FooterLeadingItemId> | null {
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
  const updateTone = updateError ? "danger" : "accent";

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
    ? `Updating ${downloadProgress?.percentage ?? 0}%`
    : installing
      ? "Installing"
      : updateError
        ? "Update failed"
        : "Update available";

  return {
    id: "updates",
    label: "App updates",
    content: (
      <div className="flex items-center gap-0.5">
        <FooterTabControl
          tooltip={
            updateError
              ? updateError
              : downloading
                ? `Updating Athas ${downloadProgress?.percentage ?? 0}%`
                : installing
                  ? "Installing update..."
                  : `Update available: ${updateInfo.version}`
          }
          tone={updateTone}
          busy={updateBusy}
          onClick={() => {
            if (!updateBusy) {
              void downloadAndInstall();
            }
          }}
        >
          {updateBusy ? (
            <LoadingIndicator label={downloading ? "Downloading" : "Installing"} compact />
          ) : (
            <DownloadSimple weight="duotone" />
          )}
          <span>{updateLabel}</span>
        </FooterTabControl>
        <FooterTabControl
          tooltip="Update Options"
          active={isUpdateMenuOpen}
          tone={updateTone}
          controlRef={updateMenuRef}
          onClick={() => setIsUpdateMenuOpen((open) => !open)}
        >
          <CaretUp weight="bold" />
        </FooterTabControl>
        <Dropdown
          isOpen={isUpdateMenuOpen}
          onClose={() => setIsUpdateMenuOpen(false)}
          anchorRef={updateMenuRef}
          anchorSide="top"
          anchorAlign="start"
          items={updateMenuItems}
          className="min-w-52.5"
        />
      </div>
    ),
  };
}
