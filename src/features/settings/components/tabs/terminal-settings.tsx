import { useEffect } from "react";
import { useSettingsStore } from "@/features/settings/store";
import { useFontStore } from "@/stores/font-store";
import Dropdown from "@/ui/dropdown";
import NumberInput from "@/ui/number-input";
import Section, { SettingRow } from "@/ui/section";
import Switch from "@/ui/switch";

const NERD_FONTS = [
  "MesloLGS NF",
  "MesloLGS Nerd Font",
  "FiraCode Nerd Font",
  "JetBrainsMono Nerd Font",
];

const FONT_HELP_TEXT =
  "Note: Selected font must be installed on your system to work correctly. If icons are missing, try installing a Nerd Font.";

export const TerminalSettings = () => {
  const { settings, updateSetting } = useSettingsStore();
  const monospaceFonts = useFontStore.use.monospaceFonts();
  const { loadMonospaceFonts } = useFontStore.use.actions();

  useEffect(() => {
    loadMonospaceFonts();
  }, [loadMonospaceFonts]);

  // Combine Nerd Fonts with system monospace fonts
  const fontOptions = [
    ...NERD_FONTS.map((font) => ({ value: font, label: `${font} (Nerd Font)` })),
    ...monospaceFonts
      .filter((f) => !NERD_FONTS.includes(f.family))
      .map((f) => ({ value: f.family, label: f.family })),
  ];

  // Add custom option if current value is not in list
  if (
    settings.terminalFontFamily &&
    !fontOptions.some((opt) => opt.value === settings.terminalFontFamily)
  ) {
    fontOptions.unshift({
      value: settings.terminalFontFamily,
      label: `${settings.terminalFontFamily} (Custom)`,
    });
  }

  return (
    <div className="space-y-4">
      <Section title="Typography">
        <SettingRow
          label="Font Family"
          description="Font family for the integrated terminal. Select a Nerd Font for best icon support."
        >
          <Dropdown
            value={settings.terminalFontFamily}
            options={fontOptions}
            onChange={(val) => updateSetting("terminalFontFamily", val)}
            className="w-64"
            size="sm"
            searchable
            placeholder="Select font..."
          />
          <p className="mt-2 text-text-lighter text-xs">{FONT_HELP_TEXT}</p>
        </SettingRow>

        <SettingRow label="Font Size" description="Terminal font size in pixels">
          <NumberInput
            min="8"
            max="32"
            value={settings.terminalFontSize}
            onChange={(val) => updateSetting("terminalFontSize", val)}
            className="w-20"
            size="xs"
          />
        </SettingRow>

        <SettingRow label="Line Height" description="Line height multiplier">
          <NumberInput
            min="1"
            max="2"
            step={0.1}
            value={settings.terminalLineHeight}
            onChange={(val) => updateSetting("terminalLineHeight", val)}
            className="w-20"
            size="xs"
          />
        </SettingRow>

        <SettingRow label="Letter Spacing" description="Additional spacing between characters">
          <NumberInput
            min="-5"
            max="5"
            step={0.1}
            value={settings.terminalLetterSpacing}
            onChange={(val) => updateSetting("terminalLetterSpacing", val)}
            className="w-20"
            size="xs"
          />
        </SettingRow>
      </Section>

      <Section title="Cursor">
        <SettingRow label="Cursor Style" description="Shape of the cursor">
          <Dropdown
            value={settings.terminalCursorStyle}
            options={[
              { value: "block", label: "Block" },
              { value: "underline", label: "Underline" },
              { value: "bar", label: "Bar" },
            ]}
            onChange={(val) =>
              updateSetting("terminalCursorStyle", val as "block" | "underline" | "bar")
            }
            className="w-32"
            size="sm"
          />
        </SettingRow>

        <SettingRow label="Blinking Cursor" description="Whether the cursor should blink">
          <Switch
            checked={settings.terminalCursorBlink}
            onChange={(val) => updateSetting("terminalCursorBlink", val)}
            size="sm"
          />
        </SettingRow>
      </Section>
    </div>
  );
};
