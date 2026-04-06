import { useEffect, useState } from "react";
import { getDefaultSetting, useSettingsStore } from "@/features/settings/store";
import Badge from "@/ui/badge";
import Input from "@/ui/input";
import Section, { SettingRow } from "../settings-section";

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
      return <p className="ui-font ui-text-sm text-text-lighter">No patterns configured.</p>;
    }

    return (
      <div className="flex flex-wrap gap-1.5">
        {patterns.map((pattern) => (
          <Badge key={pattern} variant="default" size="compact">
            {pattern}
          </Badge>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <Section title="Filters">
        <SettingRow
          label="Hidden File Patterns"
          description="Files matching these glob patterns will be hidden from the file tree"
          className="flex-col items-start gap-2"
          onReset={() =>
            updateSetting("hiddenFilePatterns", getDefaultSetting("hiddenFilePatterns"))
          }
          canReset={
            settings.hiddenFilePatterns.join(",") !==
            getDefaultSetting("hiddenFilePatterns").join(",")
          }
        >
          <Input
            id="hiddenFilePatterns"
            type="text"
            value={filePatternsInput}
            onChange={handleFilePatternsChange}
            onBlur={handleFilePatternsBlur}
            onKeyDown={(e) => handlePatternInputEnter(e, handleFilePatternsBlur)}
            placeholder="e.g., *.log, *.tmp, **/*.bak"
            size="md"
          />
          <p className="ui-font ui-text-sm text-text-lighter">Use comma-separated glob patterns.</p>
          {renderPatternPills(settings.hiddenFilePatterns)}
        </SettingRow>

        <SettingRow
          label="Hidden Directory Patterns"
          description="Directories matching these glob patterns will be hidden from the file tree"
          className="flex-col items-start gap-2"
          onReset={() =>
            updateSetting("hiddenDirectoryPatterns", getDefaultSetting("hiddenDirectoryPatterns"))
          }
          canReset={
            settings.hiddenDirectoryPatterns.join(",") !==
            getDefaultSetting("hiddenDirectoryPatterns").join(",")
          }
        >
          <Input
            id="hiddenDirectoryPatterns"
            type="text"
            value={directoryPatternsInput}
            onChange={handleDirectoryPatternsChange}
            onBlur={handleDirectoryPatternsBlur}
            onKeyDown={(e) => handlePatternInputEnter(e, handleDirectoryPatternsBlur)}
            placeholder="e.g., node_modules, .git, build/"
            size="md"
          />
          <p className="ui-font ui-text-sm text-text-lighter">Use comma-separated glob patterns.</p>
          {renderPatternPills(settings.hiddenDirectoryPatterns)}
        </SettingRow>
      </Section>
    </div>
  );
};
