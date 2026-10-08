import { useEffect, useMemo, useRef, useState } from "react";
import {
  getCliInstallCommand,
  installCli,
  isCliInstalled,
  uninstallCli,
} from "@/features/settings/services/cli-install-service";
import { IdeSettingsImportDialog } from "@/features/file-system/components/ide-settings-import-dialog";
import { useToast } from "@/utils/toast";
import { TypedConfirmAction } from "@/features/settings/components/typed-confirm-action";
import { useUpdater } from "@/features/settings/hooks/use-updater";
import { Alert, AlertDescription } from "@/ui/alert";
import { Button } from "@/ui/button";
import Command, {
  CommandEmpty,
  CommandHeader,
  CommandInput,
  CommandItemRow,
  CommandList,
} from "@/ui/command";
import { Progress } from "@/ui/progress";
import { describeOperatingSystem, getAppVersion } from "@/utils/app-environment";
import { writeClipboardText } from "@/utils/clipboard";
import { openExternalUrl } from "@/utils/external-url";
import { matchesSearchQuery } from "@/utils/search-match";
import Section, { SettingBlock, SettingsView, SettingRow } from "../settings-section";

const REPORT_BUG_CHANNELS = [
  {
    id: "discord",
    label: "Discord",
    detail: "Ask in the community server",
    url: "https://discord.gg/DD8F38wFMv",
  },
  {
    id: "github",
    label: "GitHub",
    detail: "Open a bug report issue",
    url: "https://github.com/athasdev/athas/issues/new?template=01-bug.yml",
  },
  {
    id: "twitter",
    label: "X",
    detail: "Message Athas on X",
    url: "https://x.com/athasindustries",
  },
  {
    id: "email",
    label: "Email",
    detail: "Send a report to hey@athas.dev",
    url: "mailto:hey@athas.dev",
  },
] as const;

type ReportBugChannel = (typeof REPORT_BUG_CHANNELS)[number];

export const GeneralSettings = () => {
  const {
    available,
    checking,
    downloading,
    installing,
    error,
    updateInfo,
    downloadProgress,
    checkForUpdates,
    downloadAndInstall,
  } = useUpdater(false);
  const { showToast } = useToast();

  const [cliInstalled, setCliInstalled] = useState<boolean>(false);
  const [cliChecking, setCliChecking] = useState(true);
  const [cliInstalling, setCliInstalling] = useState(false);
  const [appVersion, setAppVersion] = useState<string>("");
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [isReportBugDialogOpen, setIsReportBugDialogOpen] = useState(false);

  useEffect(() => {
    const checkCliStatus = async () => {
      try {
        const installed = await isCliInstalled();
        setCliInstalled(installed);
      } catch (error) {
        console.error("Failed to check CLI status:", error);
      } finally {
        setCliChecking(false);
      }
    };

    checkCliStatus();
  }, []);

  useEffect(() => {
    getAppVersion().then(setAppVersion);
  }, []);

  const handleInstallCli = async () => {
    setCliInstalling(true);
    try {
      const result = await installCli();
      showToast({ message: result, type: "success" });
      setCliInstalled(true);
    } catch (error) {
      showToast({
        message: `Failed to install CLI: ${error}. You may need administrator privileges.`,
        type: "error",
      });
    } finally {
      setCliInstalling(false);
    }
  };

  const handleUninstallCli = async () => {
    setCliInstalling(true);
    try {
      const result = await uninstallCli();
      showToast({ message: result, type: "success" });
      setCliInstalled(false);
    } catch (error) {
      showToast({ message: `Failed to uninstall CLI: ${error}`, type: "error" });
    } finally {
      setCliInstalling(false);
    }
  };

  const handleCopyInstallCommand = async () => {
    try {
      const command = await getCliInstallCommand();
      await writeClipboardText(command);
      showToast({ message: "Install command copied to clipboard", type: "success" });
    } catch (error) {
      showToast({ message: `Failed to copy command: ${error}`, type: "error" });
    }
  };

  const handleCheckForUpdates = async () => {
    const hasUpdate = await checkForUpdates({ ignoreSuppression: true });
    if (!hasUpdate) {
      showToast({ message: "You're on the latest version", type: "success" });
    }
  };

  const buildBugReport = async () => {
    const [version, os] = await Promise.all([getAppVersion(), describeOperatingSystem()]);

    return `Environment\n\n- App: Athas ${version}\n- OS: ${os}\n\nProblem\n\nDescribe the issue here. Steps to reproduce, expected vs actual.\n`;
  };

  const handleReportBug = async (channel: ReportBugChannel) => {
    try {
      const report = await buildBugReport();

      if (channel.id === "email") {
        await openExternalUrl(
          `${channel.url}?subject=${encodeURIComponent("Athas bug report")}&body=${encodeURIComponent(report)}`,
        );
      } else {
        await writeClipboardText(report);
        await openExternalUrl(channel.url);
        showToast({ message: "Report template copied", type: "success" });
      }

      setIsReportBugDialogOpen(false);
    } catch (err) {
      console.error("Failed to prepare bug report:", err);
      showToast({ message: "Failed to prepare bug report", type: "error" });
    }
  };

  const versionLabel = `Athas ${appVersion || "..."}`;
  const updateStatus = downloading
    ? `${versionLabel} · Downloading ${downloadProgress?.percentage ?? 0}%`
    : installing
      ? `${versionLabel} · Installing`
      : available
        ? `${versionLabel} · ${updateInfo?.version} available`
        : error
          ? `${versionLabel} · Update check failed`
          : `${versionLabel} · Up to date`;
  const cliStatus = cliChecking
    ? "Checking..."
    : cliInstalled
      ? "Installed at ~/.local/bin/athas"
      : "Open folders from your shell with athas";

  return (
    <SettingsView>
      <Section title="Application">
        <SettingRow label="Version" description={updateStatus}>
          <div className="flex flex-wrap justify-end gap-2">
            {available ? (
              <Button
                onClick={downloadAndInstall}
                disabled={downloading || installing}
                variant="accent"
              >
                {downloading
                  ? "Downloading..."
                  : installing
                    ? "Installing..."
                    : `Install ${updateInfo?.version ?? "update"}`}
              </Button>
            ) : (
              <Button
                onClick={handleCheckForUpdates}
                disabled={checking || downloading || installing}
                variant="outline"
              >
                {checking ? "Checking..." : "Check for updates"}
              </Button>
            )}
          </div>
        </SettingRow>

        {downloading && downloadProgress ? (
          <SettingBlock>
            <Progress
              value={downloadProgress.percentage}
              aria-label="Athas update download progress"
            />
          </SettingBlock>
        ) : null}

        {error ? (
          <SettingBlock>
            <Alert tone="error">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          </SettingBlock>
        ) : null}

        <SettingRow label="Shell Command" description={cliStatus}>
          <div className="flex gap-2">
            {cliInstalled ? (
              <TypedConfirmAction
                actionLabel="Uninstall"
                busyLabel="Uninstalling..."
                isBusy={cliInstalling}
                onConfirm={handleUninstallCli}
              />
            ) : (
              <>
                <Button
                  onClick={() => void handleInstallCli()}
                  disabled={cliInstalling || cliChecking}
                  variant="outline"
                >
                  {cliInstalling ? "Installing..." : "Install"}
                </Button>
                <Button
                  onClick={handleCopyInstallCommand}
                  disabled={cliChecking}
                  variant="outline"
                  tooltip="Copy install command to clipboard"
                >
                  Copy
                </Button>
              </>
            )}
          </div>
        </SettingRow>

        <SettingRow label="Import From Another Editor">
          <Button onClick={() => setIsImportDialogOpen(true)} variant="outline">
            Import
          </Button>
        </SettingRow>

        <SettingRow label="Report a Bug">
          <Button onClick={() => setIsReportBugDialogOpen(true)} variant="outline">
            Report
          </Button>
        </SettingRow>
      </Section>

      {isImportDialogOpen && (
        <IdeSettingsImportDialog onClose={() => setIsImportDialogOpen(false)} />
      )}
      {isReportBugDialogOpen && (
        <ReportBugCommandDialog
          onClose={() => setIsReportBugDialogOpen(false)}
          onSelect={(channel) => void handleReportBug(channel)}
        />
      )}
    </SettingsView>
  );
};

function ReportBugCommandDialog({
  onClose,
  onSelect,
}: {
  onClose: () => void;
  onSelect: (channel: ReportBugChannel) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const channels = useMemo(
    () =>
      REPORT_BUG_CHANNELS.filter((channel) =>
        matchesSearchQuery(query, [channel.label, channel.detail]),
      ),
    [query],
  );

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const selectedChannel = channels[selectedIndex];

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((index) => Math.min(index + 1, channels.length - 1));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((index) => Math.max(index - 1, 0));
      return;
    }

    if (event.key === "Enter" && selectedChannel) {
      event.preventDefault();
      onSelect(selectedChannel);
    }
  };

  return (
    <Command isVisible onClose={onClose} title="Report a Bug" className="w-130">
      <CommandHeader onClose={onClose}>
        <CommandInput
          ref={inputRef}
          value={query}
          onChange={setQuery}
          onKeyDown={handleKeyDown}
          placeholder="Report via..."
        />
      </CommandHeader>
      <CommandList>
        {channels.length === 0 ? (
          <CommandEmpty>No report channel matches "{query}".</CommandEmpty>
        ) : (
          channels.map((channel, index) => (
            <CommandItemRow
              key={channel.id}
              isSelected={index === selectedIndex}
              onClick={() => onSelect(channel)}
              onMouseEnter={() => setSelectedIndex(index)}
              title={channel.label}
              description={channel.detail}
            />
          ))
        )}
      </CommandList>
    </Command>
  );
}
