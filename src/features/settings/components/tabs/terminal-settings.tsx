import { Info } from "lucide-react";
import { useEffect } from "react";
import { getDefaultSetting, useSettingsStore } from "@/features/settings/store";
import { useFontStore } from "@/stores/font-store";
import NumberInput from "@/ui/number-input";
import Section, { SettingRow } from "@/ui/section";
import Select from "@/ui/select";
import Switch from "@/ui/switch";
import Tooltip from "@/ui/tooltip";

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
  // Only include Nerd Fonts if they are actually installed on the system
  const installedNerdFonts = NERD_FONTS.filter((nerdFont) =>
    monospaceFonts.some((sysFont) => sysFont.family === nerdFont),
  );

  const fontOptions = [
    ...installedNerdFonts.map((font) => ({
      value: font,
      label: `${font} (Nerd Font)`,
    })),
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
          onReset={() =>
            updateSetting("terminalFontFamily", getDefaultSetting("terminalFontFamily"))
          }
          canReset={settings.terminalFontFamily !== getDefaultSetting("terminalFontFamily")}
        >
          <div className="flex items-center gap-2">
            <Select
              value={settings.terminalFontFamily}
              options={fontOptions}
              onChange={(val) => updateSetting("terminalFontFamily", val)}
              className="w-64"
              size="sm"
              searchable
              placeholder="Select font..."
            />
            <Tooltip content={FONT_HELP_TEXT} side="left">
              <Info className="h-4 w-4 cursor-help text-text-lighter transition-colors hover:text-text" />
            </Tooltip>
          </div>
        </SettingRow>

        <SettingRow
          label="Font Size"
          description="Terminal font size in pixels"
          onReset={() => updateSetting("terminalFontSize", getDefaultSetting("terminalFontSize"))}
          canReset={settings.terminalFontSize !== getDefaultSetting("terminalFontSize")}
        >
          <NumberInput
            min="8"
            max="32"
            value={settings.terminalFontSize}
            onChange={(val) => updateSetting("terminalFontSize", val)}
            className="w-20"
            size="xs"
          />
        </SettingRow>

        <SettingRow
          label="Line Height"
          description="Line height multiplier"
          onReset={() =>
            updateSetting("terminalLineHeight", getDefaultSetting("terminalLineHeight"))
          }
          canReset={settings.terminalLineHeight !== getDefaultSetting("terminalLineHeight")}
        >
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

        <SettingRow
          label="Letter Spacing"
          description="Additional spacing between characters"
          onReset={() =>
            updateSetting("terminalLetterSpacing", getDefaultSetting("terminalLetterSpacing"))
          }
          canReset={settings.terminalLetterSpacing !== getDefaultSetting("terminalLetterSpacing")}
        >
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

        <SettingRow
          label="Scrollback"
          description="How many lines of terminal history to keep in memory"
          onReset={() =>
            updateSetting("terminalScrollback", getDefaultSetting("terminalScrollback"))
          }
          canReset={settings.terminalScrollback !== getDefaultSetting("terminalScrollback")}
        >
          <NumberInput
            min="1000"
            max="100000"
            step={1000}
            value={settings.terminalScrollback}
            onChange={(val) => updateSetting("terminalScrollback", val)}
            className="w-24"
            size="xs"
          />
        </SettingRow>
      </Section>

      <Section title="Cursor">
        <SettingRow
          label="Cursor Style"
          description="Shape of the cursor"
          onReset={() =>
            updateSetting("terminalCursorStyle", getDefaultSetting("terminalCursorStyle"))
          }
          canReset={settings.terminalCursorStyle !== getDefaultSetting("terminalCursorStyle")}
        >
          <Select
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

        <SettingRow
          label="Blinking Cursor"
          description="Whether the cursor should blink"
          onReset={() =>
            updateSetting("terminalCursorBlink", getDefaultSetting("terminalCursorBlink"))
          }
          canReset={settings.terminalCursorBlink !== getDefaultSetting("terminalCursorBlink")}
        >
          <Switch
            checked={settings.terminalCursorBlink}
            onChange={(val) => updateSetting("terminalCursorBlink", val)}
            size="sm"
          />
        </SettingRow>

        <SettingRow
          label="Cursor Width"
          description="Thickness of the bar or block cursor"
          onReset={() =>
            updateSetting("terminalCursorWidth", getDefaultSetting("terminalCursorWidth"))
          }
          canReset={settings.terminalCursorWidth !== getDefaultSetting("terminalCursorWidth")}
        >
          <NumberInput
            min="1"
            max="6"
            value={settings.terminalCursorWidth}
            onChange={(val) => updateSetting("terminalCursorWidth", val)}
            className="w-20"
            size="xs"
          />
        </SettingRow>
      </Section>
    </div>
  );
};
