import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { useToast } from "@/features/layout/contexts/toast-context";
import { useUpdater } from "@/features/settings/hooks/use-updater";
import { useSettingsStore } from "@/features/settings/store";
import Button from "@/ui/button";
import Dropdown from "@/ui/dropdown";
import Section, { SettingRow } from "@/ui/section";
import Switch from "@/ui/switch";

export const GeneralSettings = () => {
  const { settings, updateSetting } = useSettingsStore();
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

  const sidebarOptions = [
    { value: "left", label: "Left" },
    { value: "right", label: "Right" },
  ];

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

  return (
    <div className="space-y-4">
      <Section title="File Management">
        <SettingRow label="Auto Save" description="Automatically save files when editing">
          <Switch
            checked={settings.autoSave}
            onChange={(checked) => updateSetting("autoSave", checked)}
            size="sm"
          />
        </SettingRow>
      </Section>

      <Section title="Layout">
        <SettingRow label="Sidebar Position" description="Choose where to position the sidebar">
          <Dropdown
            value={settings.sidebarPosition}
            options={sidebarOptions}
            onChange={(value) => updateSetting("sidebarPosition", value as "left" | "right")}
            className="w-20"
            size="xs"
          />
        </SettingRow>
      </Section>

      <Section title="Zoom">
        <SettingRow label="Mouse Wheel Zoom" description="Use mouse wheel to zoom in/out">
          <Switch
            checked={settings.mouseWheelZoom}
            onChange={(checked) => updateSetting("mouseWheelZoom", checked)}
            size="sm"
          />
        </SettingRow>
      </Section>

      <Section title="Updates">
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
              onClick={checkForUpdates}
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
      </Section>

      <Section title="CLI Command">
        <SettingRow
          label="Terminal Command"
          description={
            cliChecking
              ? "Checking..."
              : cliInstalled
                ? "CLI command is installed at /usr/local/bin/athas"
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
              <Button
                onClick={handleInstallCli}
                disabled={cliInstalling || cliChecking}
                variant="ghost"
                size="xs"
                className="px-2 py-1"
              >
                {cliInstalling ? "Installing..." : "Install"}
              </Button>
            )}
          </div>
        </SettingRow>
      </Section>
    </div>
  );
};
