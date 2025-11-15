import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { useToast } from "@/features/layout/contexts/toast-context";
import { useUpdater } from "@/features/settings/hooks/use-updater";
import { useSettingsStore } from "@/features/settings/store";
import Button from "@/ui/button";
import Dropdown from "@/ui/dropdown";
import KeybindingBadge from "@/ui/keybinding-badge";
import Section, { SettingRow } from "@/ui/section";
import Switch from "@/ui/switch";

const isMac = typeof navigator !== "undefined" && navigator.platform.includes("Mac");

export const GeneralSettings = () => {
  const { settings, updateSetting } = useSettingsStore();
  const {
    available,
    checking,
    downloading,
    installing,
    error,
    updateInfo,
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

      <Section title="Session">
        <SettingRow
          label="Session Time Tracking"
          description="Track and display session time in status bar"
        >
          <Switch
            checked={localStorage.getItem("sessionTimeEnabled") === "true"}
            onChange={(checked) => {
              localStorage.setItem("sessionTimeEnabled", checked ? "true" : "false");
            }}
            size="sm"
          />
        </SettingRow>
      </Section>

      <Section title="Quick Access">
        <SettingRow label="Open Settings" description="Keyboard shortcut to open settings">
          <KeybindingBadge keys={isMac ? ["⌘", ","] : ["Ctrl", ","]} />
        </SettingRow>

        <SettingRow label="Toggle Sidebar" description="Show or hide the sidebar">
          <KeybindingBadge keys={isMac ? ["⌘", "B"] : ["Ctrl", "B"]} />
        </SettingRow>

        <SettingRow label="Zoom In" description="Increase zoom level">
          <KeybindingBadge keys={isMac ? ["⌘", "+"] : ["Ctrl", "+"]} />
        </SettingRow>

        <SettingRow label="Zoom Out" description="Decrease zoom level">
          <KeybindingBadge keys={isMac ? ["⌘", "-"] : ["Ctrl", "-"]} />
        </SettingRow>

        <SettingRow label="Reset Zoom" description="Reset zoom to 100%">
          <KeybindingBadge keys={isMac ? ["⌘", "0"] : ["Ctrl", "0"]} />
        </SettingRow>
      </Section>

      <Section title="Updates">
        <SettingRow
          label="Check for Updates"
          description={
            available
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
        {error && <div className="mt-2 text-red-500 text-xs">{error}</div>}
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
