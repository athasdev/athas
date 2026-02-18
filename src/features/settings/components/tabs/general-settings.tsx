import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useEffect, useState } from "react";
import { useToast } from "@/features/layout/contexts/toast-context";
import { useUpdater } from "@/features/settings/hooks/use-updater";
import { useSettingsStore } from "@/features/settings/store";
import Button from "@/ui/button";
import Section, { SettingRow } from "@/ui/section";
import Switch from "@/ui/switch";

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
  const { settings, updateSetting } = useSettingsStore();

  const [cliInstalled, setCliInstalled] = useState<boolean>(false);
  const [cliChecking, setCliChecking] = useState(true);
  const [cliInstalling, setCliInstalling] = useState(false);
  const [appVersion, setAppVersion] = useState<string>("");

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
      await writeText(command);
      showToast({ message: "Install command copied to clipboard", type: "success" });
    } catch (error) {
      showToast({ message: `Failed to copy command: ${error}`, type: "error" });
    }
  };

  const handleCheckForUpdates = async () => {
    const hasUpdate = await checkForUpdates();
    if (!hasUpdate) {
      showToast({ message: "You're on the latest version", type: "success" });
    }
  };

  const handleReportBug = async () => {
    try {
      const version = await getVersion();
      const os = await import("@tauri-apps/plugin-os");
      const plat = os.platform();
      const ver = os.version();
      const report = `Environment\n\n- App: Athas ${version}\n- OS: ${plat} ${ver}\n\nProblem\n\nDescribe the issue here. Steps to reproduce, expected vs actual.\n`;
      await writeText(report);
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl("https://github.com/athasdev/athas/issues/new?template=bug_report.md");
      showToast({ message: "Report template copied", type: "success" });
    } catch (err) {
      console.error("Failed to prepare bug report:", err);
      showToast({ message: "Failed to prepare bug report", type: "error" });
    }
  };

  return (
    <div className="space-y-4">
      <Section title="About">
        <SettingRow label="Version" description="Current application version">
          <span className="text-text-lighter text-xs">{appVersion || "..."}</span>
        </SettingRow>
        <SettingRow
          label="Check for Updates"
          description={
            downloading
              ? `Downloading ${downloadProgress?.percentage ?? 0}%`
              : installing
                ? "Installing update..."
                : available
                  ? `Version ${updateInfo?.version} available`
                  : error
                    ? "Failed to check for updates"
                    : "App is up to date"
          }
        >
          <div className="flex gap-2">
            <Button
              onClick={handleCheckForUpdates}
              disabled={checking || downloading || installing}
              variant="ghost"
              size="xs"
              className="px-2 py-1"
            >
              {checking ? "Checking..." : "Check"}
            </Button>
            {available && (
              <Button
                onClick={downloadAndInstall}
                disabled={downloading || installing}
                variant="ghost"
                size="xs"
                className="px-2 py-1"
              >
                {downloading ? "Downloading..." : installing ? "Installing..." : "Install"}
              </Button>
            )}
          </div>
        </SettingRow>

        {/* Download progress bar */}
        {downloading && downloadProgress && (
          <div className="mt-2 px-3">
            <div className="h-1 w-full overflow-hidden rounded-full bg-secondary-bg">
              <div
                className="h-full bg-accent transition-all duration-300"
                style={{ width: `${downloadProgress.percentage}%` }}
              />
            </div>
          </div>
        )}

        {error && <div className="mt-2 px-3 text-error text-xs">{error}</div>}

        <SettingRow
          label="Report a Bug"
          description="Copy environment details and open the bug report page"
        >
          <Button onClick={handleReportBug} variant="ghost" size="xs" className="px-2 py-1">
            Open
          </Button>
        </SettingRow>
      </Section>

      <Section title="CLI Command">
        <SettingRow
          label="Terminal Command"
          description={
            cliChecking
              ? "Checking..."
              : cliInstalled
                ? "CLI command is installed at $HOME/.local/bin/athas"
                : "Install 'athas' command to launch app from terminal"
          }
        >
          <div className="flex gap-2">
            {cliInstalled ? (
              <Button
                onClick={handleUninstallCli}
                disabled={cliInstalling}
                variant="ghost"
                size="xs"
                className="px-2 py-1"
              >
                {cliInstalling ? "Uninstalling..." : "Uninstall"}
              </Button>
            ) : (
              <>
                <Button
                  onClick={handleInstallCli}
                  disabled={cliInstalling || cliChecking}
                  variant="ghost"
                  size="xs"
                  className="px-2 py-1"
                >
                  {cliInstalling ? "Installing..." : "Install"}
                </Button>
                <Button
                  onClick={handleCopyInstallCommand}
                  disabled={cliChecking}
                  variant="ghost"
                  size="xs"
                  className="px-2 py-1"
                  title="Copy install command to clipboard"
                >
                  Copy
                </Button>
              </>
            )}
          </div>
        </SettingRow>
      </Section>

      <Section title="Command Bar">
        <SettingRow label="Command Bar Preview" description="Show file preview in command bar">
          <Switch
            checked={settings.commandBarPreview}
            onChange={(checked) => updateSetting("commandBarPreview", checked)}
            size="sm"
          />
        </SettingRow>
      </Section>
    </div>
  );
};
