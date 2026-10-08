import { InfoIcon, PlusIcon, TrashIcon } from "@/ui/icons";
import { useEffect } from "react";
import { getDefaultSetting } from "@/features/settings/config/default-settings";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useFontStore } from "@/features/settings/stores/font.store";
import { useTerminalProfilesStore } from "@/features/terminal/stores/profiles.store";
import { useTerminalShellsStore } from "@/features/terminal/stores/shells.store";
import { COMMON_TERMINAL_NERD_FONTS } from "@/features/terminal/constants/terminal-fonts";
import {
  DEFAULT_SHELL_OPTION_VALUE,
  SYSTEM_DEFAULT_PROFILE_ID,
  getAllTerminalProfiles,
} from "@/features/terminal/services/terminal-profiles";
import { Button } from "@/ui/button";
import { EmptyState } from "@/ui/empty";
import { Field, FieldLabel } from "@/ui/field";
import Input from "@/ui/input";
import NumberInput from "@/ui/number-input";
import Section, { SettingBlock, SettingsView, SettingRow } from "../settings-section";
import Select from "@/ui/select";
import Switch from "@/ui/switch";
import Textarea from "@/ui/textarea";

const FONT_HELP_TEXT = "Missing icons? Install a Nerd Font.";

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
      <Section title="Launch">
        <SettingRow
          label="Default Shell"
          control="select"
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
            variant="surface"
            width="full"
            searchable
            searchableTrigger="input"
          />
        </SettingRow>

        <SettingRow
          label="Default Profile"
          control="select"
          description="Used by the toolbar button and new terminals"
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
            variant="surface"
            width="full"
            searchable
            searchableTrigger="input"
          />
        </SettingRow>

        <SettingRow
          label="Shell Integration"
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
        actions={
          <Button
            variant="ghost"
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
        }
      >
        {profiles.length === 0 ? (
          <EmptyState variant="section" message="No custom profiles" />
        ) : (
          profiles.map((profile) => (
            <SettingBlock key={profile.id} className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-sans ui-text-sm font-medium text-foreground">
                    {profile.name}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  tone="danger"
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
                    variant="surface"
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
                  placeholder="Workspace directory"
                />
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
              </Field>
            </SettingBlock>
          ))
        )}
      </Section>

      <Section title="Typography">
        <SettingRow
          label="Font Family"
          control="select"
          onReset={() =>
            updateSetting("terminalFontFamily", getDefaultSetting("terminalFontFamily"))
          }
          canReset={settings.terminalFontFamily !== getDefaultSetting("terminalFontFamily")}
          labelAccessory={
            <span className="flex size-5 items-center justify-center">
              <Button variant="ghost" iconOnly tooltip={FONT_HELP_TEXT} aria-label="Font help">
                <InfoIcon />
              </Button>
            </span>
          }
        >
          <Select
            value={settings.terminalFontFamily}
            options={fontOptions}
            onChange={(val) => updateSetting("terminalFontFamily", val)}
            variant="surface"
            width="full"
            searchable
            searchableTrigger="input"
            placeholder="Select font..."
          />
        </SettingRow>

        <SettingRow
          label="Font Size"
          control="number"
          onReset={() => updateSetting("terminalFontSize", getDefaultSetting("terminalFontSize"))}
          canReset={settings.terminalFontSize !== getDefaultSetting("terminalFontSize")}
        >
          <NumberInput
            width="full"
            min="8"
            max="32"
            value={settings.terminalFontSize}
            onChange={(val) => updateSetting("terminalFontSize", val)}
          />
        </SettingRow>

        <SettingRow
          label="Line Height"
          control="number"
          onReset={() =>
            updateSetting("terminalLineHeight", getDefaultSetting("terminalLineHeight"))
          }
          canReset={settings.terminalLineHeight !== getDefaultSetting("terminalLineHeight")}
        >
          <NumberInput
            width="full"
            min="1"
            max="2"
            step={0.1}
            value={settings.terminalLineHeight}
            onChange={(val) => updateSetting("terminalLineHeight", val)}
          />
        </SettingRow>

        <SettingRow
          label="Letter Spacing"
          control="number"
          onReset={() =>
            updateSetting("terminalLetterSpacing", getDefaultSetting("terminalLetterSpacing"))
          }
          canReset={settings.terminalLetterSpacing !== getDefaultSetting("terminalLetterSpacing")}
        >
          <NumberInput
            width="full"
            min="-5"
            max="5"
            step={0.1}
            value={settings.terminalLetterSpacing}
            onChange={(val) => updateSetting("terminalLetterSpacing", val)}
          />
        </SettingRow>

        <SettingRow
          label="Scrollback"
          control="number"
          onReset={() =>
            updateSetting("terminalScrollback", getDefaultSetting("terminalScrollback"))
          }
          canReset={settings.terminalScrollback !== getDefaultSetting("terminalScrollback")}
        >
          <NumberInput
            width="full"
            min="1000"
            max="100000"
            step={1000}
            value={settings.terminalScrollback}
            onChange={(val) => updateSetting("terminalScrollback", val)}
          />
        </SettingRow>

        <SettingRow
          label="Minimum Contrast"
          control="number"
          description="1 keeps theme colors, 4.5 meets WCAG AA"
          onReset={() =>
            updateSetting(
              "terminalMinimumContrastRatio",
              getDefaultSetting("terminalMinimumContrastRatio"),
            )
          }
          canReset={
            settings.terminalMinimumContrastRatio !==
            getDefaultSetting("terminalMinimumContrastRatio")
          }
        >
          <NumberInput
            width="full"
            min="1"
            max="21"
            step={0.5}
            value={settings.terminalMinimumContrastRatio}
            onChange={(val) => updateSetting("terminalMinimumContrastRatio", val)}
          />
        </SettingRow>
      </Section>

      <Section title="Interaction">
        <SettingRow
          label="Alt Click Moves Cursor"
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
          control="select"
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
            variant="surface"
            width="full"
          />
        </SettingRow>

        <SettingRow
          label="Blinking Cursor"
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
          control="number"
          onReset={() =>
            updateSetting("terminalCursorWidth", getDefaultSetting("terminalCursorWidth"))
          }
          canReset={settings.terminalCursorWidth !== getDefaultSetting("terminalCursorWidth")}
        >
          <NumberInput
            width="full"
            min="1"
            max="6"
            value={settings.terminalCursorWidth}
            onChange={(val) => updateSetting("terminalCursorWidth", val)}
          />
        </SettingRow>

        <SettingRow
          label="Inactive Cursor Style"
          control="select"
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
            variant="surface"
            width="full"
          />
        </SettingRow>
      </Section>
    </SettingsView>
  );
};
