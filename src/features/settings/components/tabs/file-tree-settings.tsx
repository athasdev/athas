import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { getDefaultSetting, useSettingsStore } from "@/features/settings/stores/settings.store";
import type { FileTreeSortOrder } from "@/features/settings/types/settings.types";
import NumberInput from "@/ui/number-input";
import Select from "@/ui/select";
import Textarea from "@/ui/textarea";
import Section, { SETTINGS_CONTROL_WIDTHS, SettingsView, SettingRow } from "../settings-section";
import Switch from "@/ui/switch";

export const FileTreeSettings = () => {
  const settings = useSettingsStore(
    useShallow((state) => ({
      autoRevealActiveFileInFileTree: state.settings.autoRevealActiveFileInFileTree,
      compactFoldersInFileTree: state.settings.compactFoldersInFileTree,
      confirmBeforeFileDelete: state.settings.confirmBeforeFileDelete,
      fileTreeIndentSize: state.settings.fileTreeIndentSize,
      fileTreeSortOrder: state.settings.fileTreeSortOrder,
      hiddenDirectoryPatterns: state.settings.hiddenDirectoryPatterns,
      hiddenFilePatterns: state.settings.hiddenFilePatterns,
      hideRootFolderInFileTree: state.settings.hideRootFolderInFileTree,
      showFileIconsInFileTree: state.settings.showFileIconsInFileTree,
      showGitignoredFilesInFileTree: state.settings.showGitignoredFilesInFileTree,
      showGitStatusInFileTree: state.settings.showGitStatusInFileTree,
      showHiddenFilesInFileTree: state.settings.showHiddenFilesInFileTree,
      showIndentGuidesInFileTree: state.settings.showIndentGuidesInFileTree,
    })),
  );
  const updateSetting = useSettingsStore((state) => state.actions.updateSetting);

  const [filePatternsInput, setFilePatternsInput] = useState(
    settings.hiddenFilePatterns.join(", "),
  );
  const [directoryPatternsInput, setDirectoryPatternsInput] = useState(
    settings.hiddenDirectoryPatterns.join(", "),
  );

  useEffect(() => {
    setFilePatternsInput(settings.hiddenFilePatterns.join(", "));
  }, [settings.hiddenFilePatterns]);

  useEffect(() => {
    setDirectoryPatternsInput(settings.hiddenDirectoryPatterns.join(", "));
  }, [settings.hiddenDirectoryPatterns]);

  const parsePatterns = (input: string) =>
    input
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

  const commitFilePatterns = () => {
    updateSetting("hiddenFilePatterns", parsePatterns(filePatternsInput));
  };

  const commitDirectoryPatterns = () => {
    updateSetting("hiddenDirectoryPatterns", parsePatterns(directoryPatternsInput));
  };

  return (
    <SettingsView>
      <Section title="Display">
        <SettingRow
          label="Sort Order"
          description="Choose whether folders stay above files or everything sorts by name"
          onReset={() => updateSetting("fileTreeSortOrder", getDefaultSetting("fileTreeSortOrder"))}
          canReset={settings.fileTreeSortOrder !== getDefaultSetting("fileTreeSortOrder")}
        >
          <Select
            value={settings.fileTreeSortOrder}
            options={[
              { value: "folders-first", label: "Folders First" },
              { value: "name", label: "Name" },
            ]}
            onChange={(value) => updateSetting("fileTreeSortOrder", value as FileTreeSortOrder)}
            className={SETTINGS_CONTROL_WIDTHS.default}
            size="sm"
            variant="default"
          />
        </SettingRow>

        <SettingRow
          label="Indent Size"
          description="Pixels per nesting level"
          onReset={() =>
            updateSetting("fileTreeIndentSize", getDefaultSetting("fileTreeIndentSize"))
          }
          canReset={settings.fileTreeIndentSize !== getDefaultSetting("fileTreeIndentSize")}
        >
          <NumberInput
            min="8"
            max="32"
            value={settings.fileTreeIndentSize}
            onChange={(val) => updateSetting("fileTreeIndentSize", val)}
            className={SETTINGS_CONTROL_WIDTHS.numberCompact}
            size="md"
          />
        </SettingRow>

        <SettingRow
          label="Show File Icons"
          description="Show themed file and folder icons"
          onReset={() =>
            updateSetting("showFileIconsInFileTree", getDefaultSetting("showFileIconsInFileTree"))
          }
          canReset={
            settings.showFileIconsInFileTree !== getDefaultSetting("showFileIconsInFileTree")
          }
        >
          <Switch
            checked={settings.showFileIconsInFileTree}
            onChange={(checked) => updateSetting("showFileIconsInFileTree", checked)}
            size="sm"
          />
        </SettingRow>

        <SettingRow
          label="Show Indent Guides"
          description="Show vertical guides for nested folders"
          onReset={() =>
            updateSetting(
              "showIndentGuidesInFileTree",
              getDefaultSetting("showIndentGuidesInFileTree"),
            )
          }
          canReset={
            settings.showIndentGuidesInFileTree !== getDefaultSetting("showIndentGuidesInFileTree")
          }
        >
          <Switch
            checked={settings.showIndentGuidesInFileTree}
            onChange={(checked) => updateSetting("showIndentGuidesInFileTree", checked)}
            size="sm"
          />
        </SettingRow>

        <SettingRow
          label="Compact Folders"
          description="Collapse single-child folder chains"
          onReset={() =>
            updateSetting("compactFoldersInFileTree", getDefaultSetting("compactFoldersInFileTree"))
          }
          canReset={
            settings.compactFoldersInFileTree !== getDefaultSetting("compactFoldersInFileTree")
          }
        >
          <Switch
            checked={settings.compactFoldersInFileTree}
            onChange={(checked) => updateSetting("compactFoldersInFileTree", checked)}
            size="sm"
          />
        </SettingRow>

        <SettingRow
          label="Hide Root Folder"
          description="Show project files directly at the top level"
          onReset={() =>
            updateSetting("hideRootFolderInFileTree", getDefaultSetting("hideRootFolderInFileTree"))
          }
          canReset={
            settings.hideRootFolderInFileTree !== getDefaultSetting("hideRootFolderInFileTree")
          }
        >
          <Switch
            checked={settings.hideRootFolderInFileTree}
            onChange={(checked) => updateSetting("hideRootFolderInFileTree", checked)}
            size="sm"
          />
        </SettingRow>

        <SettingRow
          label="Show Hidden Files"
          description="Show dotfiles and hidden directories"
          onReset={() =>
            updateSetting(
              "showHiddenFilesInFileTree",
              getDefaultSetting("showHiddenFilesInFileTree"),
            )
          }
          canReset={
            settings.showHiddenFilesInFileTree !== getDefaultSetting("showHiddenFilesInFileTree")
          }
        >
          <Switch
            checked={settings.showHiddenFilesInFileTree}
            onChange={(checked) => updateSetting("showHiddenFilesInFileTree", checked)}
            size="sm"
          />
        </SettingRow>

        <SettingRow
          label="Respect .gitignore"
          description="Hide files matched by root and nested .gitignore files"
          onReset={() =>
            updateSetting(
              "showGitignoredFilesInFileTree",
              getDefaultSetting("showGitignoredFilesInFileTree"),
            )
          }
          canReset={
            settings.showGitignoredFilesInFileTree !==
            getDefaultSetting("showGitignoredFilesInFileTree")
          }
        >
          <Switch
            checked={!settings.showGitignoredFilesInFileTree}
            onChange={(checked) => updateSetting("showGitignoredFilesInFileTree", !checked)}
            size="sm"
          />
        </SettingRow>

        <SettingRow
          label="Show Git Status"
          description="Display Git color decorations beside changed files"
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

      <Section title="Behavior">
        <SettingRow
          label="Auto Reveal Active File"
          description="Expand and scroll Files to the active editor file"
          onReset={() =>
            updateSetting(
              "autoRevealActiveFileInFileTree",
              getDefaultSetting("autoRevealActiveFileInFileTree"),
            )
          }
          canReset={
            settings.autoRevealActiveFileInFileTree !==
            getDefaultSetting("autoRevealActiveFileInFileTree")
          }
        >
          <Switch
            checked={settings.autoRevealActiveFileInFileTree}
            onChange={(checked) => updateSetting("autoRevealActiveFileInFileTree", checked)}
            size="sm"
          />
        </SettingRow>

        <SettingRow
          label="Confirm Before Delete"
          description="Ask for confirmation before deleting a file or folder"
          onReset={() =>
            updateSetting("confirmBeforeFileDelete", getDefaultSetting("confirmBeforeFileDelete"))
          }
          canReset={
            settings.confirmBeforeFileDelete !== getDefaultSetting("confirmBeforeFileDelete")
          }
        >
          <Switch
            checked={settings.confirmBeforeFileDelete}
            onChange={(checked) => updateSetting("confirmBeforeFileDelete", checked)}
            size="sm"
          />
        </SettingRow>
      </Section>

      <Section title="Filters">
        <SettingRow
          label="Hidden Files"
          description="Comma-separated glob patterns"
          onReset={() =>
            updateSetting("hiddenFilePatterns", getDefaultSetting("hiddenFilePatterns"))
          }
          canReset={
            settings.hiddenFilePatterns.join(",") !==
            getDefaultSetting("hiddenFilePatterns").join(",")
          }
        >
          <Textarea
            value={filePatternsInput}
            onChange={(e) => setFilePatternsInput(e.target.value)}
            onBlur={commitFilePatterns}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                commitFilePatterns();
              }
            }}
            placeholder="*.log, *.tmp, **/*.bak"
            rows={2}
            size="md"
            className="w-48 max-w-full resize-none"
          />
        </SettingRow>

        <SettingRow
          label="Hidden Directories"
          description="Comma-separated glob patterns"
          onReset={() =>
            updateSetting("hiddenDirectoryPatterns", getDefaultSetting("hiddenDirectoryPatterns"))
          }
          canReset={
            settings.hiddenDirectoryPatterns.join(",") !==
            getDefaultSetting("hiddenDirectoryPatterns").join(",")
          }
        >
          <Textarea
            value={directoryPatternsInput}
            onChange={(e) => setDirectoryPatternsInput(e.target.value)}
            onBlur={commitDirectoryPatterns}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                commitDirectoryPatterns();
              }
            }}
            placeholder="node_modules, .git, build/"
            rows={2}
            size="md"
            className="w-48 max-w-full resize-none"
          />
        </SettingRow>
      </Section>
    </SettingsView>
  );
};
