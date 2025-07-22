import Dropdown from "@/components/ui/dropdown";
import KeybindingBadge from "@/components/ui/keybinding-badge";
import Section, { SettingRow } from "@/components/ui/section";
import Toggle from "@/components/ui/toggle";
import { useSettingsStore } from "@/stores/settings-store";

const isMac = typeof navigator !== "undefined" && navigator.platform.includes("Mac");

export const GeneralSettings = () => {
  const { settings, updateSetting } = useSettingsStore();

  const sidebarOptions = [
    { value: "left", label: "Left" },
    { value: "right", label: "Right" },
  ];

  return (
    <div className="space-y-4">
      <Section title="File Management">
        <SettingRow label="Auto Save" description="Automatically save files when editing">
          <Toggle
            checked={settings.autoSave}
            onChange={checked => updateSetting("autoSave", checked)}
            size="sm"
          />
        </SettingRow>
      </Section>

      <Section title="Layout">
        <SettingRow label="Sidebar Position" description="Choose where to position the sidebar">
          <Dropdown
            value={settings.sidebarPosition}
            options={sidebarOptions}
            onChange={value => updateSetting("sidebarPosition", value as "left" | "right")}
            className="w-20"
            size="xs"
          />
        </SettingRow>
      </Section>

      <Section title="Zoom">
        <SettingRow label="Mouse Wheel Zoom" description="Use mouse wheel to zoom in/out">
          <Toggle
            checked={settings.mouseWheelZoom}
            onChange={checked => updateSetting("mouseWheelZoom", checked)}
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
    </div>
  );
};
