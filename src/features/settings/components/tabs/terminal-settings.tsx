import { Info, Plus, Trash2 } from "lucide-react";
import { useEffect } from "react";
import { getDefaultSetting, useSettingsStore } from "@/features/settings/store";
import { useFontStore } from "@/features/settings/stores/font-store";
import { useTerminalProfilesStore } from "@/features/terminal/stores/profiles-store";
import { useTerminalShellsStore } from "@/features/terminal/stores/shells-store";
import {
  DEFAULT_SHELL_OPTION_VALUE,
  SYSTEM_DEFAULT_PROFILE_ID,
  getAllTerminalProfiles,
} from "@/features/terminal/utils/terminal-profiles";
import { Button } from "@/ui/button";
import Input from "@/ui/input";
import NumberInput from "@/ui/number-input";
import Section, { SETTINGS_CONTROL_WIDTHS, SettingRow } from "../settings-section";
import Select from "@/ui/select";
import Switch from "@/ui/switch";
import Textarea from "@/ui/textarea";
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
  const settings = useSettingsStore((state) => state.settings);
  const updateSetting = useSettingsStore((state) => state.updateSetting);
  const monospaceFonts = useFontStore.use.monospaceFonts();
  const { loadMonospaceFonts } = useFontStore.use.actions();
  const profiles = useTerminalProfilesStore.use.profiles();
  const profileActions = useTerminalProfilesStore.use.actions();
  const shells = useTerminalShellsStore.use.shells();

  useEffect(() => {
    loadMonospaceFonts();
    void useTerminalShellsStore.getState().actions.loadShells();
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

  const shellOptions = [
    { value: DEFAULT_SHELL_OPTION_VALUE, label: "System Default" },
    ...shells.map((shell) => ({
      value: shell.id,
      label: shell.name,
    })),
  ];
  const selectedDefaultShellId = shellOptions.some(
    (option) => option.value === settings.terminalDefaultShellId,
  )
    ? settings.terminalDefaultShellId || DEFAULT_SHELL_OPTION_VALUE
    : DEFAULT_SHELL_OPTION_VALUE;

  const allProfiles = getAllTerminalProfiles(shells, profiles);
  const profileOptions = allProfiles.map((profile) => ({
    value: profile.id,
    label: profile.name,
  }));
  const selectedDefaultProfileId = profileOptions.some(
    (option) => option.value === settings.terminalDefaultProfileId,
  )
    ? settings.terminalDefaultProfileId || SYSTEM_DEFAULT_PROFILE_ID
    : SYSTEM_DEFAULT_PROFILE_ID;

  useEffect(() => {
    if (
      settings.terminalDefaultShellId &&
      !shells.some((shell) => shell.id === settings.terminalDefaultShellId)
    ) {
      void updateSetting("terminalDefaultShellId", "");
    }
  }, [settings.terminalDefaultShellId, shells, updateSetting]);

  useEffect(() => {
    if (
      settings.terminalDefaultProfileId &&
      !allProfiles.some((profile) => profile.id === settings.terminalDefaultProfileId)
    ) {
      void updateSetting("terminalDefaultProfileId", "");
    }
  }, [allProfiles, settings.terminalDefaultProfileId, updateSetting]);

  return (
    <div className="space-y-4">
      <Section
        title="Launch"
        description="Choose which shell and profile new terminal tabs should use by default."
      >
        <SettingRow
          label="Default Shell"
          description="Fallback shell when a terminal profile does not override it."
          onReset={() =>
            updateSetting("terminalDefaultShellId", getDefaultSetting("terminalDefaultShellId"))
          }
          canReset={settings.terminalDefaultShellId !== getDefaultSetting("terminalDefaultShellId")}
        >
          <Select
            value={selectedDefaultShellId}
            options={shellOptions}
            onChange={(value) =>
              updateSetting(
                "terminalDefaultShellId",
                value === DEFAULT_SHELL_OPTION_VALUE ? "" : value,
              )
            }
            className={SETTINGS_CONTROL_WIDTHS.xwide}
            size="xs"
            variant="secondary"
          />
        </SettingRow>

        <SettingRow
          label="Default Profile"
          description="Used by the terminal toolbar button and Cmd+T when the terminal is focused."
          onReset={() =>
            updateSetting("terminalDefaultProfileId", getDefaultSetting("terminalDefaultProfileId"))
          }
          canReset={
            settings.terminalDefaultProfileId !== getDefaultSetting("terminalDefaultProfileId")
          }
        >
          <Select
            value={selectedDefaultProfileId}
            options={profileOptions}
            onChange={(value) =>
              updateSetting(
                "terminalDefaultProfileId",
                value === SYSTEM_DEFAULT_PROFILE_ID ? "" : value,
              )
            }
            className={SETTINGS_CONTROL_WIDTHS.xwide}
            size="xs"
            variant="secondary"
            searchable
            searchableTrigger="input"
          />
        </SettingRow>
      </Section>

      <Section
        title="Profiles"
        description="Create reusable launch presets with a shell override, startup directory, and optional startup commands."
      >
        <div className="space-y-3 px-1">
          <div className="flex items-center justify-between">
            <div className="ui-font ui-text-sm text-text-lighter">
              Built-in profiles are generated from detected shells. Custom profiles appear in the
              terminal toolbar profile picker.
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                profileActions.addProfile({
                  name: `Custom Profile ${profiles.length + 1}`,
                  shell: settings.terminalDefaultShellId || undefined,
                  startupCommands: [],
                })
              }
            >
              <Plus className="mr-1" />
              Add Profile
            </Button>
          </div>

          {profiles.length === 0 ? (
            <div className="ui-font ui-text-sm rounded-xl border border-dashed border-border/70 bg-secondary-bg/50 px-3 py-3 text-text-lighter">
              No custom terminal profiles yet.
            </div>
          ) : (
            profiles.map((profile) => (
              <div
                key={profile.id}
                className="space-y-3 rounded-xl border border-border/70 bg-secondary-bg/60 p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="ui-font ui-text-sm mb-1 text-text">{profile.name}</div>
                    <div className="ui-font ui-text-sm text-text-lighter">
                      Visible in the terminal profile picker.
                    </div>
                  </div>
                  <Button
                    variant="danger"
                    size="xs"
                    onClick={() => profileActions.deleteProfile(profile.id)}
                    aria-label={`Delete ${profile.name}`}
                  >
                    <Trash2 />
                  </Button>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="ui-font ui-text-sm text-text">Name</label>
                    <Input
                      value={profile.name}
                      onChange={(event) =>
                        profileActions.updateProfile(profile.id, {
                          name: event.target.value,
                        })
                      }
                      placeholder="My Profile"
                      size="sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="ui-font ui-text-sm text-text">Shell</label>
                    <Select
                      value={profile.shell || DEFAULT_SHELL_OPTION_VALUE}
                      options={shellOptions}
                      onChange={(value) =>
                        profileActions.updateProfile(profile.id, {
                          shell: value === DEFAULT_SHELL_OPTION_VALUE ? undefined : value,
                        })
                      }
                      className="w-full"
                      size="sm"
                      variant="secondary"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="ui-font ui-text-sm text-text">Startup Directory</label>
                  <Input
                    value={profile.startupDirectory || ""}
                    onChange={(event) =>
                      profileActions.updateProfile(profile.id, {
                        startupDirectory: event.target.value || undefined,
                      })
                    }
                    placeholder="Leave empty to use the current workspace directory"
                    size="sm"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="ui-font ui-text-sm text-text">Startup Commands</label>
                  <Textarea
                    value={(profile.startupCommands || []).join("\n")}
                    onChange={(event) =>
                      profileActions.updateProfile(profile.id, {
                        startupCommands: event.target.value
                          .split("\n")
                          .map((line) => line.trim())
                          .filter(Boolean),
                      })
                    }
                    placeholder="One command per line"
                    rows={3}
                    size="sm"
                  />
                </div>
              </div>
            ))
          )}
        </div>
      </Section>

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
              className={SETTINGS_CONTROL_WIDTHS.xwide}
              size="xs"
              variant="secondary"
              searchable
              searchableTrigger="input"
              placeholder="Select font..."
            />
            <Tooltip content={FONT_HELP_TEXT} side="left">
              <Info className="size-4 cursor-help text-text-lighter transition-colors hover:text-text" />
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
            className={SETTINGS_CONTROL_WIDTHS.number}
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
            className={SETTINGS_CONTROL_WIDTHS.number}
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
            className={SETTINGS_CONTROL_WIDTHS.number}
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
            className={SETTINGS_CONTROL_WIDTHS.default}
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
            className={SETTINGS_CONTROL_WIDTHS.default}
            size="xs"
            variant="secondary"
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
            className={SETTINGS_CONTROL_WIDTHS.number}
            size="xs"
          />
        </SettingRow>
      </Section>
    </div>
  );
};
