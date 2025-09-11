import { FontSelector } from "@/components/ui/font-selector";
import NumberInput from "@/components/ui/number-input";
import Section, { SettingRow } from "@/components/ui/section";
import Switch from "@/components/ui/switch";
import { useSettingsStore } from "@/settings/store";

export const EditorSettings = () => {
  const { settings, updateSetting } = useSettingsStore();

  return (
    <div className="space-y-4">
      <Section title="Typography">
        <SettingRow label="Font Family" description="Editor font family">
          <FontSelector
            value={settings.fontFamily}
            onChange={(fontFamily) => updateSetting("fontFamily", fontFamily)}
            className="w-48"
            monospaceOnly={true}
          />
        </SettingRow>

        <SettingRow label="Font Size" description="Editor font size in pixels">
          <NumberInput
            min="8"
            max="32"
            value={settings.fontSize}
            onChange={(val) => updateSetting("fontSize", val)}
            className="w-16"
            size="xs"
          />
        </SettingRow>

        <SettingRow label="Tab Size" description="Number of spaces per tab">
          <NumberInput
            min="1"
            max="8"
            value={settings.tabSize}
            onChange={(val) => updateSetting("tabSize", val)}
            className="w-16"
            size="xs"
          />
        </SettingRow>
      </Section>

      <Section title="Display">
        <SettingRow label="Word Wrap" description="Wrap lines that exceed viewport width">
          <Switch
            checked={settings.wordWrap}
            onChange={(checked) => updateSetting("wordWrap", checked)}
            size="sm"
          />
        </SettingRow>

        <SettingRow label="Line Numbers" description="Show line numbers in the editor">
          <Switch
            checked={settings.lineNumbers}
            onChange={(checked) => updateSetting("lineNumbers", checked)}
            size="sm"
          />
        </SettingRow>
      </Section>

      <Section title="Input">
        <SettingRow label="Vim Mode" description="Enable vim keybindings and commands">
          <Switch
            checked={settings.vimMode}
            onChange={(checked) => updateSetting("vimMode", checked)}
            size="sm"
          />
        </SettingRow>
      </Section>
    </div>
  );
};
