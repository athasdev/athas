import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { IdeSettingsImportDialog } from "@/features/file-system/components/ide-settings-import-dialog";
import { useToast } from "@/features/layout/contexts/toast-context";
import { TypedConfirmAction } from "@/features/settings/components/typed-confirm-action";
import { useUpdater } from "@/features/settings/hooks/use-updater";
import { Button } from "@/ui/button";
import Command, {
  CommandEmpty,
  CommandHeader,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/ui/command";
import { writeClipboardText } from "@/utils/clipboard";
import { matchesSearchQuery } from "@/utils/search-match";
import { SettingRow } from "../settings-section";

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
        const installed = await invoke<boolean>("check_cli_installed");
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
    getVersion().then(setAppVersion);
  }, []);

  const handleInstallCli = async () => {
    setCliInstalling(true);
    try {
      const result = await invoke<string>("install_cli_command");
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
      const result = await invoke<string>("uninstall_cli_command");
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
      const command = await invoke<string>("get_cli_install_command");
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
    const version = await getVersion();
    const os = await import("@tauri-apps/plugin-os");
    const plat = os.platform();
    const ver = os.version();

    return `Environment\n\n- App: Athas ${version}\n- OS: ${plat} ${ver}\n\nProblem\n\nDescribe the issue here. Steps to reproduce, expected vs actual.\n`;
  };

  const handleReportBug = async (channel: ReportBugChannel) => {
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      const report = await buildBugReport();

      if (channel.id === "email") {
        await openUrl(
          `${channel.url}?subject=${encodeURIComponent("Athas bug report")}&body=${encodeURIComponent(report)}`,
        );
      } else {
        await writeClipboardText(report);
        await openUrl(channel.url);
        showToast({ message: "Report template copied", type: "success" });
      }

      setIsReportBugDialogOpen(false);
    } catch (err) {
      console.error("Failed to prepare bug report:", err);
      showToast({ message: "Failed to prepare bug report", type: "error" });
    }
  };

  return (
    <div className="space-y-4">
      <SettingRow
        label="Version"
        description="Check for updates and install the latest app version."
      >
        <div className="flex flex-wrap justify-end gap-2">
          {available ? (
            <Button
              onClick={downloadAndInstall}
              disabled={downloading || installing}
              variant="default"
              compact
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
              variant="default"
              compact
            >
              {checking ? "Checking..." : "Check"}
            </Button>
          )}
        </div>
      </SettingRow>

      <div className="ui-font ui-text-xs -mt-3 px-1 text-text-lighter/75">
        {downloading
          ? `Athas ${appVersion || "..."} · Downloading ${downloadProgress?.percentage ?? 0}%`
          : installing
            ? `Athas ${appVersion || "..."} · Installing update...`
            : available
              ? `Athas ${appVersion || "..."} · Version ${updateInfo?.version} available`
              : error
                ? `Athas ${appVersion || "..."} · Failed to check for updates`
                : `Athas ${appVersion || "..."} · App is up to date`}
      </div>

      {downloading && downloadProgress && (
        <div className="px-3">
          <div className="h-1 w-full overflow-hidden rounded-full bg-secondary-bg">
            <div
              className="h-full bg-accent transition-all duration-300"
              style={{ width: `${downloadProgress.percentage}%` }}
            />
          </div>
        </div>
      )}

      {error && <div className="ui-font ui-text-sm px-3 text-error">{error}</div>}

      <SettingRow
        label="Terminal Command"
        description="Install the `athas` command to open folders and files from your terminal."
      >
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
                variant="default"
                compact
              >
                {cliInstalling ? "Installing..." : "Install"}
              </Button>
              <Button
                onClick={handleCopyInstallCommand}
                disabled={cliChecking}
                variant="default"
                tooltip="Copy install command to clipboard"
                compact
              >
                Copy
              </Button>
            </>
          )}
        </div>
      </SettingRow>

      <div className="ui-font ui-text-xs -mt-3 px-1 text-text-lighter/75">
        {cliChecking
          ? "Checking..."
          : cliInstalled
            ? "CLI command is installed at $HOME/.local/bin/athas"
            : "CLI command is not installed."}
      </div>

      <SettingRow label="Import Settings" description="Import matching setup from another editor.">
        <Button onClick={() => setIsImportDialogOpen(true)} variant="default" compact>
          Import
        </Button>
      </SettingRow>

      <SettingRow
        label="Report a Bug"
        description="Choose where to report an issue with environment details."
      >
        <Button onClick={() => setIsReportBugDialogOpen(true)} variant="default" compact>
          Open
        </Button>
      </SettingRow>

      {isImportDialogOpen && (
        <IdeSettingsImportDialog onClose={() => setIsImportDialogOpen(false)} />
      )}
      {isReportBugDialogOpen && (
        <ReportBugCommandDialog
          onClose={() => setIsReportBugDialogOpen(false)}
          onSelect={(channel) => void handleReportBug(channel)}
        />
      )}
    </div>
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
    <Command isVisible onClose={onClose} title="Report a Bug" className="w-[520px]">
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
            <CommandItem
              key={channel.id}
              isSelected={index === selectedIndex}
              onClick={() => onSelect(channel)}
              onMouseEnter={() => setSelectedIndex(index)}
              className="h-8 items-center justify-between px-3"
            >
              <span className="ui-font ui-text-sm text-text">{channel.label}</span>
              <span className="ui-font ui-text-sm shrink-0 text-text-lighter">
                {channel.detail}
              </span>
            </CommandItem>
          ))
        )}
      </CommandList>
    </Command>
  );
}
