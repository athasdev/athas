import { useEffect, useState } from "react";
import { useSettingsStore } from "@/features/settings/store";
import Section, { SettingRow } from "@/ui/section";
import Switch from "@/ui/switch";

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

  const handleFilePatternsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFilePatternsInput(e.target.value);
  };

  const handleDirectoryPatternsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setDirectoryPatternsInput(e.target.value);
  };

  const parsePatterns = (input: string) =>
    input
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

  const handleFilePatternsBlur = () => {
    updateSetting("hiddenFilePatterns", parsePatterns(filePatternsInput));
  };

  const handleDirectoryPatternsBlur = () => {
    updateSetting("hiddenDirectoryPatterns", parsePatterns(directoryPatternsInput));
  };

  const handlePatternInputEnter = (
    e: React.KeyboardEvent<HTMLInputElement>,
    onCommit: () => void,
  ) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onCommit();
    }
  };

  const renderPatternPills = (patterns: string[]) => {
    if (patterns.length === 0) {
      return <p className="text-[11px] text-text-lighter">No patterns configured.</p>;
    }

    return (
      <div className="flex flex-wrap gap-1.5">
        {patterns.map((pattern) => (
          <span
            key={pattern}
            className="ui-font rounded-md border border-border bg-secondary-bg px-2 py-1 text-[11px] text-text-lighter"
          >
            {pattern}
          </span>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <Section title="File Explorer Filters">
        <SettingRow
          label="Hidden File Patterns"
          description="Files matching these glob patterns will be hidden from the file tree"
          className="flex-col items-start gap-2"
        >
          <input
            id="hiddenFilePatterns"
            type="text"
            value={filePatternsInput}
            onChange={handleFilePatternsChange}
            onBlur={handleFilePatternsBlur}
            onKeyDown={(e) => handlePatternInputEnter(e, handleFilePatternsBlur)}
            placeholder="e.g., *.log, *.tmp, **/*.bak"
            className="ui-font h-9 w-full rounded-xl border border-border bg-secondary-bg/80 px-3 text-text text-xs placeholder:text-text-lighter focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30"
          />
          <p className="text-[11px] text-text-lighter">Use comma-separated glob patterns.</p>
          {renderPatternPills(settings.hiddenFilePatterns)}
        </SettingRow>

        <SettingRow
          label="Hidden Directory Patterns"
          description="Directories matching these glob patterns will be hidden from the file tree"
          className="flex-col items-start gap-2"
        >
          <input
            id="hiddenDirectoryPatterns"
            type="text"
            value={directoryPatternsInput}
            onChange={handleDirectoryPatternsChange}
            onBlur={handleDirectoryPatternsBlur}
            onKeyDown={(e) => handlePatternInputEnter(e, handleDirectoryPatternsBlur)}
            placeholder="e.g., node_modules, .git, build/"
            className="ui-font h-9 w-full rounded-xl border border-border bg-secondary-bg/80 px-3 text-text text-xs placeholder:text-text-lighter focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30"
          />
          <p className="text-[11px] text-text-lighter">Use comma-separated glob patterns.</p>
          {renderPatternPills(settings.hiddenDirectoryPatterns)}
        </SettingRow>
      </Section>

      <Section title="Git View">
        <SettingRow
          label="Folder-Based Changes"
          description="Show Git changes in a folder tree, similar to File Explorer"
        >
          <Switch
            checked={settings.gitChangesFolderView}
            onChange={(checked) => updateSetting("gitChangesFolderView", checked)}
            size="sm"
          />
        </SettingRow>
      </Section>
    </div>
  );
};
