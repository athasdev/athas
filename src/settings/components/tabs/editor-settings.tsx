import { FontSelector } from "@/components/ui/font-selector";
import Input from "@/components/ui/input";
import Section, { SettingRow } from "@/components/ui/section";
import Switch from "@/components/ui/switch";
import { useSettingsStore } from "@/settings/stores/settings-store";

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
          <Input
            type="number"
            min="8"
            max="32"
            value={settings.fontSize}
            onChange={(e) => updateSetting("fontSize", parseInt(e.target.value))}
            className="w-16"
            size="xs"
          />
        </SettingRow>

        <SettingRow label="Tab Size" description="Number of spaces per tab">
          <Input
            type="number"
            min="1"
            max="8"
            value={settings.tabSize}
            onChange={(e) => updateSetting("tabSize", parseInt(e.target.value))}
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

      <Section title="Features">
        <SettingRow label="AI Completion" description="Enable AI-powered code completion">
          <Switch
            checked={settings.aiCompletion}
            onChange={(checked) => updateSetting("aiCompletion", checked)}
            size="sm"
          />
        </SettingRow>
      </Section>
    </div>
  );
};
