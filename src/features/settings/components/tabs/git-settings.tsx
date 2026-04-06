import { getDefaultSetting, useSettingsStore } from "@/features/settings/store";
import Section, { SettingRow } from "../settings-section";
import Select from "@/ui/select";
import Switch from "@/ui/switch";

export const GitSettings = () => {
  const { settings, updateSetting } = useSettingsStore();

  const handleGitFeatureToggle = (enabled: boolean) => {
    updateSetting("coreFeatures", {
      ...settings.coreFeatures,
      git: enabled,
    });
  };

  return (
    <div className="space-y-4">
      <Section title="Integration">
        <SettingRow
          label="Git Integration"
          description="Enable source control management with Git repositories"
          onReset={() => updateSetting("coreFeatures", getDefaultSetting("coreFeatures"))}
          canReset={settings.coreFeatures.git !== getDefaultSetting("coreFeatures").git}
        >
          <Switch checked={settings.coreFeatures.git} onChange={handleGitFeatureToggle} size="sm" />
        </SettingRow>

        <SettingRow
          label="Auto Refresh Git Status"
          description="Refresh the Git view automatically after relevant file changes and Git events"
          onReset={() =>
            updateSetting("autoRefreshGitStatus", getDefaultSetting("autoRefreshGitStatus"))
          }
          canReset={settings.autoRefreshGitStatus !== getDefaultSetting("autoRefreshGitStatus")}
        >
          <Switch
            checked={settings.autoRefreshGitStatus}
            onChange={(checked) => updateSetting("autoRefreshGitStatus", checked)}
            size="sm"
          />
        </SettingRow>

        <SettingRow
          label="Confirm Before Discard"
          description="Show a confirmation before discarding file or repository changes"
          onReset={() =>
            updateSetting("confirmBeforeDiscard", getDefaultSetting("confirmBeforeDiscard"))
          }
          canReset={settings.confirmBeforeDiscard !== getDefaultSetting("confirmBeforeDiscard")}
        >
          <Switch
            checked={settings.confirmBeforeDiscard}
            onChange={(checked) => updateSetting("confirmBeforeDiscard", checked)}
            size="sm"
          />
        </SettingRow>
      </Section>

      <Section title="Git View">
        <SettingRow
          label="Folder-Based Changes"
          description="Show Git changes in a folder tree, similar to File Explorer"
          onReset={() =>
            updateSetting("gitChangesFolderView", getDefaultSetting("gitChangesFolderView"))
          }
          canReset={settings.gitChangesFolderView !== getDefaultSetting("gitChangesFolderView")}
        >
          <Switch
            checked={settings.gitChangesFolderView}
            onChange={(checked) => updateSetting("gitChangesFolderView", checked)}
            size="sm"
          />
        </SettingRow>

        <SettingRow
          label="Show Untracked Files"
          description="Display untracked files in the Git status panel"
          onReset={() =>
            updateSetting("showUntrackedFiles", getDefaultSetting("showUntrackedFiles"))
          }
          canReset={settings.showUntrackedFiles !== getDefaultSetting("showUntrackedFiles")}
        >
          <Switch
            checked={settings.showUntrackedFiles}
            onChange={(checked) => updateSetting("showUntrackedFiles", checked)}
            size="sm"
          />
        </SettingRow>

        <SettingRow
          label="Show Staged First"
          description="Render staged changes above unstaged changes in the Git panel"
          onReset={() => updateSetting("showStagedFirst", getDefaultSetting("showStagedFirst"))}
          canReset={settings.showStagedFirst !== getDefaultSetting("showStagedFirst")}
        >
          <Switch
            checked={settings.showStagedFirst}
            onChange={(checked) => updateSetting("showStagedFirst", checked)}
            size="sm"
          />
        </SettingRow>

        <SettingRow
          label="Open Diff On Click"
          description="Open the diff when clicking a changed file instead of opening the file directly"
          onReset={() => updateSetting("openDiffOnClick", getDefaultSetting("openDiffOnClick"))}
          canReset={settings.openDiffOnClick !== getDefaultSetting("openDiffOnClick")}
        >
          <Switch
            checked={settings.openDiffOnClick}
            onChange={(checked) => updateSetting("openDiffOnClick", checked)}
            size="sm"
          />
        </SettingRow>

        <SettingRow
          label="Compact Git Status Badges"
          description="Use a denser layout for diff stats and staged labels in the Git panel"
          onReset={() =>
            updateSetting("compactGitStatusBadges", getDefaultSetting("compactGitStatusBadges"))
          }
          canReset={settings.compactGitStatusBadges !== getDefaultSetting("compactGitStatusBadges")}
        >
          <Switch
            checked={settings.compactGitStatusBadges}
            onChange={(checked) => updateSetting("compactGitStatusBadges", checked)}
            size="sm"
          />
        </SettingRow>

        <SettingRow
          label="Collapse Empty Sections"
          description="Hide empty Git sections like Staged Changes when they have no items"
          onReset={() =>
            updateSetting("collapseEmptyGitSections", getDefaultSetting("collapseEmptyGitSections"))
          }
          canReset={
            settings.collapseEmptyGitSections !== getDefaultSetting("collapseEmptyGitSections")
          }
        >
          <Switch
            checked={settings.collapseEmptyGitSections}
            onChange={(checked) => updateSetting("collapseEmptyGitSections", checked)}
            size="sm"
          />
        </SettingRow>

        <SettingRow
          label="Remember Last Git Panel Mode"
          description="Restore the last open bottom Git panel section when reopening the Git view"
          onReset={() =>
            updateSetting("rememberLastGitPanelMode", getDefaultSetting("rememberLastGitPanelMode"))
          }
          canReset={
            settings.rememberLastGitPanelMode !== getDefaultSetting("rememberLastGitPanelMode")
          }
        >
          <Switch
            checked={settings.rememberLastGitPanelMode}
            onChange={(checked) => updateSetting("rememberLastGitPanelMode", checked)}
            size="sm"
          />
        </SettingRow>

        <SettingRow
          label="Default Diff View"
          description="Choose the default layout for Git diffs"
          onReset={() =>
            updateSetting("gitDefaultDiffView", getDefaultSetting("gitDefaultDiffView"))
          }
          canReset={settings.gitDefaultDiffView !== getDefaultSetting("gitDefaultDiffView")}
        >
          <Select
            value={settings.gitDefaultDiffView}
            options={[
              { value: "unified", label: "Unified" },
              { value: "split", label: "Split" },
            ]}
            onChange={(value) => updateSetting("gitDefaultDiffView", value as "unified" | "split")}
            className="w-32"
            size="xs"
            variant="secondary"
          />
        </SettingRow>
      </Section>

      <Section title="Editor">
        <SettingRow
          label="Enable Inline Blame"
          description="Show inline Git blame metadata for the current line in the editor"
          onReset={() =>
            updateSetting("enableInlineGitBlame", getDefaultSetting("enableInlineGitBlame"))
          }
          canReset={settings.enableInlineGitBlame !== getDefaultSetting("enableInlineGitBlame")}
        >
          <Switch
            checked={settings.enableInlineGitBlame}
            onChange={(checked) => updateSetting("enableInlineGitBlame", checked)}
            size="sm"
          />
        </SettingRow>

        <SettingRow
          label="Enable Git Gutter"
          description="Show added, modified, and deleted indicators in the editor gutter"
          onReset={() => updateSetting("enableGitGutter", getDefaultSetting("enableGitGutter"))}
          canReset={settings.enableGitGutter !== getDefaultSetting("enableGitGutter")}
        >
          <Switch
            checked={settings.enableGitGutter}
            onChange={(checked) => updateSetting("enableGitGutter", checked)}
            size="sm"
          />
        </SettingRow>
      </Section>

      <Section title="File Tree">
        <SettingRow
          label="Show Git Status In File Tree"
          description="Display Git color decorations in the file explorer"
          onReset={() =>
            updateSetting("showGitStatusInFileTree", getDefaultSetting("showGitStatusInFileTree"))
          }
          canReset={
            settings.showGitStatusInFileTree !== getDefaultSetting("showGitStatusInFileTree")
          }
        >
          <Switch
            checked={settings.showGitStatusInFileTree}
            onChange={(checked) => updateSetting("showGitStatusInFileTree", checked)}
            size="sm"
          />
        </SettingRow>
      </Section>
    </div>
  );
};
