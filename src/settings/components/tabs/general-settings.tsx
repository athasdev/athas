import Button from "@/components/ui/button";
import Dropdown from "@/components/ui/dropdown";
import KeybindingBadge from "@/components/ui/keybinding-badge";
import Section, { SettingRow } from "@/components/ui/section";
import Switch from "@/components/ui/switch";
import { useUpdater } from "@/settings/hooks/use-updater";
import { useSettingsStore } from "@/settings/stores/settings-store";

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

  const sidebarOptions = [
    { value: "left", label: "Left" },
    { value: "right", label: "Right" },
  ];

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
    </div>
  );
};
