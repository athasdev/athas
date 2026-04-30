import { useEffect, useState } from "react";
import {
  FILE_TREE_DENSITY_OPTIONS,
  type FileTreeDensity,
} from "@/features/file-explorer/lib/file-tree-density";
import { getDefaultSetting, useSettingsStore } from "@/features/settings/store";
import NumberInput from "@/ui/number-input";
import Select from "@/ui/select";
import Section, { SETTINGS_CONTROL_WIDTHS, SettingRow } from "../settings-section";
import { controlFieldSurfaceVariants } from "@/ui/control-field";
import Switch from "@/ui/switch";
import { cn } from "@/utils/cn";

export const FileTreeSettings = () => {
  const { settings, updateSetting } = useSettingsStore();

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
    <div className="space-y-4">
      <Section title="Display">
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
            size="xs"
          />
        </SettingRow>

        <SettingRow
          label="Density"
          description="Choose file tree row spacing"
          onReset={() => updateSetting("fileTreeDensity", getDefaultSetting("fileTreeDensity"))}
          canReset={settings.fileTreeDensity !== getDefaultSetting("fileTreeDensity")}
        >
          <Select
            value={settings.fileTreeDensity}
            options={FILE_TREE_DENSITY_OPTIONS}
            onChange={(value) => updateSetting("fileTreeDensity", value as FileTreeDensity)}
            className={SETTINGS_CONTROL_WIDTHS.default}
            size="xs"
            variant="secondary"
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
          label="Show Gitignored Files"
          description="Show files matched by .gitignore"
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
            checked={settings.showGitignoredFilesInFileTree}
            onChange={(checked) => updateSetting("showGitignoredFilesInFileTree", checked)}
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
          <textarea
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
            className={cn(
              controlFieldSurfaceVariants({ variant: "secondary" }),
              "ui-font ui-text-sm w-48 resize-none px-2 py-1.5 placeholder:text-text-lighter",
            )}
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
          <textarea
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
            className={cn(
              controlFieldSurfaceVariants({ variant: "secondary" }),
              "ui-font ui-text-sm w-48 resize-none px-2 py-1.5 placeholder:text-text-lighter",
            )}
          />
        </SettingRow>
      </Section>
    </div>
  );
};
