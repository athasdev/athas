import { InfoIcon, PlusIcon, TrashIcon } from "@/ui/icons";
import { useEffect } from "react";
import { getDefaultSetting, useSettingsStore } from "@/features/settings/stores/settings.store";
import { useFontStore } from "@/features/settings/stores/font.store";
import { useTerminalProfilesStore } from "@/features/terminal/stores/profiles.store";
import { useTerminalShellsStore } from "@/features/terminal/stores/shells.store";
import { COMMON_TERMINAL_NERD_FONTS } from "@/features/terminal/utils/terminal-fonts";
import {
  DEFAULT_SHELL_OPTION_VALUE,
  SYSTEM_DEFAULT_PROFILE_ID,
  getAllTerminalProfiles,
} from "@/features/terminal/utils/terminal-profiles";
import { Button } from "@/ui/button";
import { EmptyState } from "@/ui/empty";
import { Field, FieldDescription, FieldLabel } from "@/ui/field";
import Input from "@/ui/input";
import NumberInput from "@/ui/number-input";
import Section, { SettingBlock, SettingsView, SettingRow } from "../settings-section";
import Select from "@/ui/select";
import Switch from "@/ui/switch";
import Textarea from "@/ui/textarea";

const FONT_HELP_TEXT =
  "Note: Selected font must be installed on your system to work correctly. If icons are missing, try installing a Nerd Font.";

export const TerminalSettings = () => {
  const settings = useSettingsStore((state) => state.settings);
  const updateSetting = useSettingsStore((state) => state.actions.updateSetting);
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
  const installedNerdFonts = COMMON_TERMINAL_NERD_FONTS.filter((nerdFont) =>
    monospaceFonts.some((sysFont) => sysFont.family === nerdFont),
  );

  const fontOptions = [
    ...installedNerdFonts.map((font) => ({
      value: font,
      label: `${font} (Nerd Font)`,
    })),
    ...monospaceFonts
      .filter((f) => !COMMON_TERMINAL_NERD_FONTS.includes(f.family))
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
    <SettingsView>
      <Section
        title="Launch"
        description="Choose which shell and profile new terminal tabs should use by default"
      >
        <SettingRow
          label="Default Shell"
          description="Fallback shell when a terminal profile does not override it"
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
            variant="default"
            searchable
            searchableTrigger="input"
          />
        </SettingRow>

        <SettingRow
          label="Default Profile"
          description="Used by the terminal toolbar button and Cmd+T when the terminal is focused"
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
            variant="default"
            searchable
            searchableTrigger="input"
          />
        </SettingRow>

        <SettingRow
          label="Shell Integration"
          description="Track commands, exit codes, and the working directory in zsh, bash, and fish"
          onReset={() =>
            updateSetting("terminalShellIntegration", getDefaultSetting("terminalShellIntegration"))
          }
          canReset={
            settings.terminalShellIntegration !== getDefaultSetting("terminalShellIntegration")
          }
        >
          <Switch
            checked={settings.terminalShellIntegration}
            onChange={(checked) => updateSetting("terminalShellIntegration", checked)}
          />
        </SettingRow>
      </Section>

      <Section
        title="Profiles"
        description="Create reusable launch presets with a shell override, startup directory, and optional startup commands"
      >
        <SettingRow
          label="Custom Profiles"
          description="Built-in profiles come from detected shells. Custom profiles appear in the terminal toolbar profile picker."
        >
          <Button
            variant="default"
            onClick={() =>
              profileActions.addProfile({
                name: `Custom Profile ${profiles.length + 1}`,
                shell: settings.terminalDefaultShellId || undefined,
                startupCommands: [],
              })
            }
          >
            <PlusIcon />
            Add Profile
          </Button>
        </SettingRow>

        {profiles.length === 0 ? (
          <EmptyState className="py-6" message="No custom terminal profiles yet" />
        ) : (
          profiles.map((profile) => (
            <SettingBlock key={profile.id} className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-sans ui-text-base text-foreground">{profile.name}</div>
                  <div className="font-sans ui-text-sm text-subtle-foreground">
                    Visible in the terminal profile picker
                  </div>
                </div>
                <Button
                  variant="danger"
                  onClick={() => profileActions.deleteProfile(profile.id)}
                  aria-label={`Delete ${profile.name}`}
                  tooltip={`Delete ${profile.name}`}
                  iconOnly
                >
                  <TrashIcon />
                </Button>
              </div>

              <div className="grid gap-3 @md/settings:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor={`terminal-profile-name-${profile.id}`}>Name</FieldLabel>
                  <Input
                    id={`terminal-profile-name-${profile.id}`}
                    value={profile.name}
                    onChange={(event) =>
                      profileActions.updateProfile(profile.id, {
                        name: event.target.value,
                      })
                    }
                    placeholder="My Profile"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor={`terminal-profile-shell-${profile.id}`}>Shell</FieldLabel>
                  <Select
                    id={`terminal-profile-shell-${profile.id}`}
                    value={profile.shell || DEFAULT_SHELL_OPTION_VALUE}
                    options={shellOptions}
                    onChange={(value) =>
                      profileActions.updateProfile(profile.id, {
                        shell: value === DEFAULT_SHELL_OPTION_VALUE ? undefined : value,
                      })
                    }
                    width="full"
                    variant="default"
                    searchable
                    searchableTrigger="input"
                  />
                </Field>
              </div>

              <Field>
                <FieldLabel htmlFor={`terminal-profile-directory-${profile.id}`}>
                  Startup Directory
                </FieldLabel>
                <Input
                  id={`terminal-profile-directory-${profile.id}`}
                  value={profile.startupDirectory || ""}
                  onChange={(event) =>
                    profileActions.updateProfile(profile.id, {
                      startupDirectory: event.target.value || undefined,
                    })
                  }
                  placeholder="Leave empty to use the current workspace directory"
                />
                <FieldDescription>
                  Leave empty to use the current workspace directory.
                </FieldDescription>
              </Field>

              <Field>
                <FieldLabel htmlFor={`terminal-profile-commands-${profile.id}`}>
                  Startup Commands
                </FieldLabel>
                <Textarea
                  id={`terminal-profile-commands-${profile.id}`}
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
                />
                <FieldDescription>Enter one command per line.</FieldDescription>
              </Field>
            </SettingBlock>
          ))
        )}
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
              variant="default"
              searchable
              searchableTrigger="input"
              placeholder="Select font..."
            />
            <Button variant="ghost" iconOnly tooltip={FONT_HELP_TEXT} aria-label="Font help">
              <InfoIcon />
            </Button>
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
          />
        </SettingRow>
      </Section>

      <Section title="Interaction">
        <SettingRow
          label="Alt Click Moves Cursor"
          description="Move the shell prompt cursor to the clicked position when supported"
          onReset={() =>
            updateSetting(
              "terminalAltClickMovesCursor",
              getDefaultSetting("terminalAltClickMovesCursor"),
            )
          }
          canReset={
            settings.terminalAltClickMovesCursor !==
            getDefaultSetting("terminalAltClickMovesCursor")
          }
        >
          <Switch
            checked={settings.terminalAltClickMovesCursor}
            onChange={(checked) => updateSetting("terminalAltClickMovesCursor", checked)}
          />
        </SettingRow>

        <SettingRow
          label="Option as Meta"
          description="Treat the Option key as Meta in terminal applications on macOS"
          onReset={() =>
            updateSetting("terminalMacOptionIsMeta", getDefaultSetting("terminalMacOptionIsMeta"))
          }
          canReset={
            settings.terminalMacOptionIsMeta !== getDefaultSetting("terminalMacOptionIsMeta")
          }
        >
          <Switch
            checked={settings.terminalMacOptionIsMeta}
            onChange={(checked) => updateSetting("terminalMacOptionIsMeta", checked)}
          />
        </SettingRow>

        <SettingRow
          label="Right Click Selects Word"
          description="Select the word under the pointer before opening the context menu"
          onReset={() =>
            updateSetting(
              "terminalRightClickSelectsWord",
              getDefaultSetting("terminalRightClickSelectsWord"),
            )
          }
          canReset={
            settings.terminalRightClickSelectsWord !==
            getDefaultSetting("terminalRightClickSelectsWord")
          }
        >
          <Switch
            checked={settings.terminalRightClickSelectsWord}
            onChange={(checked) => updateSetting("terminalRightClickSelectsWord", checked)}
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
            variant="default"
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
          />
        </SettingRow>

        <SettingRow
          label="Inactive Cursor Style"
          description="Appearance of the terminal cursor when the terminal is not focused"
          onReset={() =>
            updateSetting(
              "terminalCursorInactiveStyle",
              getDefaultSetting("terminalCursorInactiveStyle"),
            )
          }
          canReset={
            settings.terminalCursorInactiveStyle !==
            getDefaultSetting("terminalCursorInactiveStyle")
          }
        >
          <Select
            value={settings.terminalCursorInactiveStyle}
            options={[
              { value: "outline", label: "Outline" },
              { value: "block", label: "Block" },
              { value: "bar", label: "Bar" },
              { value: "underline", label: "Underline" },
              { value: "none", label: "Hidden" },
            ]}
            onChange={(value) =>
              updateSetting(
                "terminalCursorInactiveStyle",
                value as typeof settings.terminalCursorInactiveStyle,
              )
            }
            variant="default"
          />
        </SettingRow>
      </Section>
    </SettingsView>
  );
};
